// State management
let appState = {
    serverUrl: '',
    apiKey: '',
    useCorsProxy: false,
    corsProxyUrl: 'https://corsproxy.io/?',
    results: [], // Array of libraries with duplicates
    pendingDelete: null, // Stores item to delete: { libraryIndex, groupIndex, fileIndex, itemId, itemTitle, path, libraryName }
    selectedFiles: new Set() // stores keys in format "libIdx_groupIdx_fileIdx"
};

// Initialize on DOM load
document.addEventListener('DOMContentLoaded', () => {
    // Check if hosted on HTTPS and show warning if needed
    checkMixedContent();

    // Load saved settings if any
    const savedUrl = localStorage.getItem('emby_server_url');
    const savedApiKey = localStorage.getItem('emby_api_key');
    if (savedUrl) document.getElementById('embyServerUrl').value = savedUrl;
    if (savedApiKey) document.getElementById('apiKey').value = savedApiKey;

    document.getElementById('embyServerUrl').addEventListener('input', checkMixedContent);
    document.getElementById('useCorsProxy').addEventListener('change', (e) => {
        appState.useCorsProxy = e.target.checked;
        checkMixedContent();
    });

    document.getElementById('confirmDeleteBtn').addEventListener('click', executeDelete);
});

// Check Mixed Content (HTTPS page requesting HTTP)
function checkMixedContent() {
    let url = document.getElementById('embyServerUrl').value.trim();
    const warning = document.getElementById('mixedContentWarning');
    const isHttpsPage = window.location.protocol === 'https:';
    const isHttpEmby = url.startsWith('http://') || (/^(\d{1,3}\.){3}\d{1,3}/.test(url) && !url.startsWith('https://'));
    const isProxyEnabled = document.getElementById('useCorsProxy').checked;

    if (isHttpsPage && isHttpEmby && !isProxyEnabled) {
        warning.classList.remove('hidden');
    } else {
        warning.classList.add('hidden');
    }
}

// Toggle Advanced/CORS settings panel
function toggleAdvancedSettings() {
    const panel = document.getElementById('advanced-settings');
    const icon = document.getElementById('advanced-toggle-icon');
    panel.classList.toggle('hidden');
    icon.textContent = panel.classList.contains('hidden') ? '▼' : '▲';
}

// Help Modals
function openCorsHelpModal() {
    document.getElementById('cors-modal').classList.remove('hidden');
}

function closeCorsHelpModal() {
    document.getElementById('cors-modal').classList.add('hidden');
}

// Format API URL (handles protocol, trailing slashes, and CORS proxy)
function formatEmbyUrl(serverUrl) {
    let formatted = serverUrl.trim();
    if (!/^https?:\/\//i.test(formatted)) {
        formatted = 'http://' + formatted;
    }
    return formatted.replace(/\/+$/, '');
}

function buildApiUrl(endpoint) {
    const fullUrl = `${appState.serverUrl}${endpoint}`;
    if (appState.useCorsProxy) {
        const proxyPrefix = appState.corsProxyUrl.trim();
        return `${proxyPrefix}${encodeURIComponent(fullUrl)}`;
    }
    return fullUrl;
}

// Unified Fetch with diagnostic error handling
async function embyFetch(endpoint, options = {}) {
    const targetUrl = buildApiUrl(endpoint);
    try {
        const response = await fetch(targetUrl, {
            ...options,
            headers: {
                'X-Emby-Token': appState.apiKey,
                ...(options.headers || {})
            }
        });

        if (!response.ok) {
            const errorText = await response.text().catch(() => '');
            if (response.status === 401) {
                throw new Error('Authentication failed: Invalid API Key.');
            } else if (response.status === 403) {
                throw new Error('Permission denied: Operation not permitted by Emby server.');
            } else if (response.status === 404) {
                throw new Error('Endpoint or item not found (404).');
            } else {
                throw new Error(`Emby Server returned error ${response.status}: ${errorText || response.statusText}`);
            }
        }
        return response;
    } catch (err) {
        // Handle CORS / Network error detection
        if (err instanceof TypeError && err.message.toLowerCase().includes('fetch')) {
            let msg = 'Network or CORS connection error! ';
            if (window.location.protocol === 'https:' && appState.serverUrl.startsWith('http:')) {
                msg += 'Your browser is blocking insecure HTTP requests from this HTTPS page. Please check "Enable CORS Proxy" in Connection Settings.';
            } else {
                msg += 'Unable to reach your Emby server. Please verify the URL/IP, or enable CORS proxy in Connection Settings.';
            }
            throw new Error(msg);
        }
        throw err;
    }
}

// Main Scan function
async function findDuplicates() {
    const rawServerUrl = document.getElementById('embyServerUrl').value.trim();
    const apiKey = document.getElementById('apiKey').value.trim();
    const libraryType = document.getElementById('libraryType').value;
    const resultsDiv = document.getElementById('results');
    const loadingOverlay = document.getElementById('loading-overlay');
    const loadingText = document.getElementById('loading-text');

    if (!rawServerUrl) {
        showToast('Please enter your Emby Server URL.', 'warning');
        return;
    }
    if (!apiKey) {
        showToast('Please enter your Emby API Key.', 'warning');
        return;
    }

    appState.serverUrl = formatEmbyUrl(rawServerUrl);
    appState.apiKey = apiKey;
    appState.useCorsProxy = document.getElementById('useCorsProxy').checked;
    appState.corsProxyUrl = document.getElementById('corsProxyUrl').value.trim() || 'https://corsproxy.io/?';

    // Save to local storage for convenience
    localStorage.setItem('emby_server_url', rawServerUrl);
    localStorage.setItem('emby_api_key', apiKey);

    resultsDiv.innerHTML = '';
    appState.selectedFiles.clear();
    document.getElementById('filter-bar').classList.add('hidden');
    document.getElementById('selection-bar').classList.add('hidden');
    loadingOverlay.classList.remove('hidden');

    try {
        loadingText.textContent = 'Connecting & fetching Emby libraries...';
        const libraries = await fetchLibraries();

        let filteredLibraries = libraries;
        if (libraryType === 'movies') {
            filteredLibraries = libraries.filter(lib => lib.CollectionType === 'movies');
        } else if (libraryType === 'tvshows') {
            filteredLibraries = libraries.filter(lib => lib.CollectionType === 'tvshows' || lib.CollectionType === 'series');
        } else {
            // All: movies and tvshows
            filteredLibraries = libraries.filter(lib =>
                lib.CollectionType === 'movies' || lib.CollectionType === 'tvshows' || lib.CollectionType === 'series'
            );
        }

        if (filteredLibraries.length === 0) {
            resultsDiv.innerHTML = `
                <div class="card">
                    <p>No matching libraries found for selected type (${escapeHtml(libraryType)}).</p>
                </div>`;
            return;
        }

        const duplicateResults = [];

        for (let i = 0; i < filteredLibraries.length; i++) {
            const library = filteredLibraries[i];
            const isTv = library.CollectionType === 'tvshows' || library.CollectionType === 'series';

            loadingText.textContent = `Scanning library ${i + 1} of ${filteredLibraries.length}: "${library.Name}"...`;

            if (isTv) {
                // TV Shows / Episodes
                const episodes = await fetchEpisodesFromLibrary(library.ItemId);
                const duplicates = findDuplicatesInTvLibrary(episodes);
                if (duplicates.length > 0) {
                    duplicateResults.push({
                        libraryId: library.ItemId,
                        libraryName: library.Name,
                        type: 'tvshows',
                        duplicateGroups: duplicates,
                        count: duplicates.length
                    });
                }
            } else {
                // Movies
                const movies = await fetchMoviesFromLibrary(library.ItemId);
                const duplicates = findDuplicatesInMovieLibrary(movies);
                if (duplicates.length > 0) {
                    duplicateResults.push({
                        libraryId: library.ItemId,
                        libraryName: library.Name,
                        type: 'movies',
                        duplicateGroups: duplicates,
                        count: duplicates.length
                    });
                }
            }
        }

        appState.results = duplicateResults;
        displayResults();

        if (duplicateResults.length > 0) {
            document.getElementById('filter-bar').classList.remove('hidden');
            document.getElementById('selection-bar').classList.remove('hidden');
            updateSelectionUI();
            showToast(`Found duplicate items in ${duplicateResults.length} libraries!`, 'success');
        } else {
            showToast('Scan complete: No duplicate media found!', 'success');
        }

    } catch (error) {
        console.error(error);
        resultsDiv.innerHTML = `
            <div class="card">
                <div class="alert-banner warning-banner">
                    <strong>Error occurred:</strong> ${escapeHtml(error.message)}
                </div>
                <button class="btn-secondary" onclick="openCorsHelpModal()">📖 View Troubleshooting Guide</button>
            </div>`;
        showToast(error.message, 'error');
    } finally {
        loadingOverlay.classList.add('hidden');
    }
}

// API: Fetch Virtual Folders / Libraries
async function fetchLibraries() {
    const response = await embyFetch(`/emby/Library/VirtualFolders?api_key=${appState.apiKey}`);
    return await response.json();
}

// API: Fetch Movies
async function fetchMoviesFromLibrary(libraryId) {
    const fields = 'Path,ProductionYear,MediaSources,Width,Height,Size,Container';
    const response = await embyFetch(`/emby/Items?Recursive=true&ParentId=${libraryId}&IncludeItemTypes=Movie&Fields=${fields}&api_key=${appState.apiKey}`);
    const data = await response.json();
    return data.Items || [];
}

// API: Fetch Episodes
async function fetchEpisodesFromLibrary(libraryId) {
    const fields = 'Path,SeriesName,SeasonName,IndexNumber,ParentIndexNumber,ProductionYear,MediaSources,Width,Height,Size,Container';
    const response = await embyFetch(`/emby/Items?Recursive=true&ParentId=${libraryId}&IncludeItemTypes=Episode&Fields=${fields}&api_key=${appState.apiKey}`);
    const data = await response.json();
    return data.Items || [];
}

// Algorithm: Find best file in a group to keep (4K > 1080p > 720p > SD, then largest size/bitrate)
function getBestFileIndex(files) {
    if (!files || files.length === 0) return 0;
    let bestIdx = 0;
    let maxScore = -1;

    files.forEach((f, idx) => {
        let resScore = 0;
        const maxDim = Math.max(f.width || 0, f.height || 0);
        if (maxDim >= 3800) resScore = 4000;
        else if (maxDim >= 1900) resScore = 3000;
        else if (maxDim >= 1200) resScore = 2000;
        else resScore = 1000;

        const score = (resScore * 1000000000000) + (f.size || 0);
        if (score > maxScore) {
            maxScore = score;
            bestIdx = idx;
        }
    });

    return bestIdx;
}

// Duplicate Detection: Movies
function findDuplicatesInMovieLibrary(movies) {
    const groups = {};

    movies.forEach(movie => {
        if (!movie.Name) return;
        const normalizedName = movie.Name.trim().toLowerCase();
        const year = movie.ProductionYear || '';
        const key = year ? `${normalizedName}_${year}` : normalizedName;

        if (!groups[key]) {
            groups[key] = {
                title: movie.Name.trim(),
                year: movie.ProductionYear,
                type: 'movie',
                primaryItemId: movie.Id,
                files: []
            };
        }

        if (movie.MediaSources && movie.MediaSources.length > 1) {
            movie.MediaSources.forEach(ms => {
                groups[key].files.push({
                    itemId: movie.Id,
                    mediaSourceId: ms.Id,
                    name: movie.Name,
                    path: ms.Path || movie.Path || 'Unknown path',
                    size: ms.Size || movie.Size,
                    width: ms.Width || movie.Width,
                    height: ms.Height || movie.Height,
                    container: ms.Container || movie.Container,
                    year: movie.ProductionYear
                });
            });
        } else {
            groups[key].files.push({
                itemId: movie.Id,
                name: movie.Name,
                path: movie.Path || 'Unknown path',
                size: movie.Size,
                width: movie.Width,
                height: movie.Height,
                container: movie.Container,
                year: movie.ProductionYear
            });
        }
    });

    // Check for misidentified movies (same name, differing years)
    const nameGroups = {};
    movies.forEach(movie => {
        if (!movie.Name) return;
        const name = movie.Name.trim();
        if (!nameGroups[name]) nameGroups[name] = [];
        nameGroups[name].push(movie);
    });

    for (const [name, items] of Object.entries(nameGroups)) {
        if (items.length > 1) {
            const distinctYears = new Set(items.map(m => m.ProductionYear).filter(Boolean));
            if (distinctYears.size > 1) {
                const misidentifiedKey = `misidentified_${name.toLowerCase()}`;
                if (!groups[misidentifiedKey]) {
                    groups[misidentifiedKey] = {
                        title: `${name} (Different Years / Possible Misidentification)`,
                        year: Array.from(distinctYears).join(', '),
                        type: 'movie',
                        primaryItemId: items[0].Id,
                        files: items.map(m => ({
                            itemId: m.Id,
                            name: `${m.Name} (${m.ProductionYear || 'N/A'})`,
                            path: m.Path || 'Unknown path',
                            size: m.Size,
                            width: m.Width,
                            height: m.Height,
                            container: m.Container,
                            year: m.ProductionYear
                        }))
                    };
                }
            }
        }
    }

    // Filter only groups with duplicates (more than 1 file)
    const duplicateList = [];
    for (const [key, group] of Object.entries(groups)) {
        if (group.files.length > 1) {
            const uniqueFiles = [];
            const seenPaths = new Set();
            for (const f of group.files) {
                const pKey = `${f.itemId}_${f.path}`;
                if (!seenPaths.has(pKey)) {
                    seenPaths.add(pKey);
                    uniqueFiles.push(f);
                }
            }
            if (uniqueFiles.length > 1) {
                group.files = uniqueFiles;
                duplicateList.push(group);
            }
        }
    }

    return duplicateList;
}

// Duplicate Detection: TV Series / Episodes
function findDuplicatesInTvLibrary(episodes) {
    const groups = {};

    episodes.forEach(ep => {
        const seriesName = ep.SeriesName || 'Unknown Series';
        const season = ep.ParentIndexNumber !== undefined ? ep.ParentIndexNumber : '?';
        const episodeNum = ep.IndexNumber !== undefined ? ep.IndexNumber : '?';
        const epName = ep.Name ? ` - ${ep.Name}` : '';

        const sPad = String(season).padStart(2, '0');
        const ePad = String(episodeNum).padStart(2, '0');
        const key = `${seriesName.trim().toLowerCase()}_s${sPad}e${ePad}`;

        const displayTitle = `${seriesName} - S${sPad}E${ePad}${epName}`;

        if (!groups[key]) {
            groups[key] = {
                title: displayTitle,
                year: ep.ProductionYear,
                type: 'episode',
                seriesName: seriesName,
                season: season,
                episode: episodeNum,
                primaryItemId: ep.Id,
                files: []
            };
        }

        if (ep.MediaSources && ep.MediaSources.length > 1) {
            ep.MediaSources.forEach(ms => {
                groups[key].files.push({
                    itemId: ep.Id,
                    mediaSourceId: ms.Id,
                    name: displayTitle,
                    path: ms.Path || ep.Path || 'Unknown path',
                    size: ms.Size || ep.Size,
                    width: ms.Width || ep.Width,
                    height: ms.Height || ep.Height,
                    container: ms.Container || ep.Container,
                    year: ep.ProductionYear
                });
            });
        } else {
            groups[key].files.push({
                itemId: ep.Id,
                name: displayTitle,
                path: ep.Path || 'Unknown path',
                size: ep.Size,
                width: ep.Width,
                height: ep.Height,
                container: ep.Container,
                year: ep.ProductionYear
            });
        }
    });

    const duplicateList = [];
    for (const [key, group] of Object.entries(groups)) {
        if (group.files.length > 1) {
            const uniqueFiles = [];
            const seenPaths = new Set();
            for (const f of group.files) {
                const pKey = `${f.itemId}_${f.path}`;
                if (!seenPaths.has(pKey)) {
                    seenPaths.add(pKey);
                    uniqueFiles.push(f);
                }
            }
            if (uniqueFiles.length > 1) {
                group.files = uniqueFiles;
                duplicateList.push(group);
            }
        }
    }

    return duplicateList;
}

// Display Results in DOM
function displayResults() {
    const resultsDiv = document.getElementById('results');
    resultsDiv.innerHTML = '';

    if (appState.results.length === 0) {
        resultsDiv.innerHTML = `
            <div class="card text-center">
                <p>🎉 No duplicate movies or episodes found in any scanned library!</p>
            </div>`;
        return;
    }

    appState.results.forEach((libraryResult, libIdx) => {
        const libraryBox = document.createElement('div');
        libraryBox.className = 'library-box';
        libraryBox.id = `library-box-${libIdx}`;

        const isTv = libraryResult.type === 'tvshows';
        const badgeClass = isTv ? 'badge-tv' : 'badge-movie';
        const badgeLabel = isTv ? '📺 TV Series' : '🎬 Movies';

        libraryBox.innerHTML = `
            <div class="library-header" onclick="toggleLibraryAccordion(${libIdx})">
                <div class="library-header-info">
                    <span class="library-badge ${badgeClass}">${badgeLabel}</span>
                    <h3 class="library-title">${escapeHtml(libraryResult.libraryName)}</h3>
                    <span class="library-count-pill" id="lib-count-pill-${libIdx}">${libraryResult.count} Duplicates</span>
                </div>
                <div class="library-actions">
                    <button class="btn-secondary btn-sm" onclick="event.stopPropagation(); downloadLibraryReport(${libIdx})">
                        💾 Download Report
                    </button>
                    <span id="accordion-arrow-${libIdx}" style="font-size: 14px; margin-left: 6px;">▼</span>
                </div>
            </div>
            <div class="library-content" id="library-content-${libIdx}">
                ${renderDuplicateGroups(libraryResult.duplicateGroups, libIdx)}
            </div>
        `;

        resultsDiv.appendChild(libraryBox);
    });
}

// Image error fallback
function handleImageError(img, fallbackEmoji) {
    const placeholder = document.createElement('div');
    placeholder.className = 'media-poster-placeholder';
    placeholder.textContent = fallbackEmoji;
    img.replaceWith(placeholder);
}

// Render individual duplicate items/cards
function renderDuplicateGroups(groups, libIdx) {
    if (groups.length === 0) {
        return '<p class="helper-text">All duplicates in this library have been resolved!</p>';
    }

    return groups.map((group, groupIdx) => {
        const posterUrl = `${appState.serverUrl}/emby/Items/${group.primaryItemId}/Images/Primary?maxWidth=150&api_key=${appState.apiKey}`;
        const proxiedPosterUrl = appState.useCorsProxy ? `${appState.corsProxyUrl}${encodeURIComponent(posterUrl)}` : posterUrl;
        const fallbackIcon = group.type === 'episode' ? '📺' : '🎬';
        const bestIdx = getBestFileIndex(group.files);

        return `
            <div class="duplicate-group" id="group-${libIdx}-${groupIdx}">
                <div class="group-header">
                    <img class="media-poster" 
                         src="${proxiedPosterUrl}" 
                         alt="${escapeHtml(group.title)}"
                         onerror="handleImageError(this, '${fallbackIcon}')">
                    <div class="group-details">
                        <h4 class="group-title">${escapeHtml(group.title)}</h4>
                        <div class="group-meta">
                            ${group.year ? `<span class="meta-chip">Year: ${escapeHtml(String(group.year))}</span>` : ''}
                            <span class="meta-chip danger" id="badge-count-${libIdx}-${groupIdx}">${group.files.length} Copies Found</span>
                        </div>
                    </div>
                </div>

                <div class="files-list">
                    ${group.files.map((file, fileIdx) => {
                        const sizeFormatted = file.size ? formatBytes(file.size) : null;
                        const resLabel = getResolutionLabel(file.width, file.height);
                        const isBest = (fileIdx === bestIdx && group.files.length > 1);
                        const fileKey = `${libIdx}_${groupIdx}_${fileIdx}`;
                        const isSelected = appState.selectedFiles.has(fileKey);

                        return `
                            <div class="file-row ${isSelected ? 'is-selected' : ''}" id="file-${libIdx}-${groupIdx}-${fileIdx}">
                                <div class="file-info">
                                    <div style="display:flex; align-items:center; gap:8px;">
                                        <label class="file-select-checkbox" title="Select for batch delete">
                                            <input type="checkbox" class="file-checkbox" ${isSelected ? 'checked' : ''} onchange="toggleFileSelection(${libIdx}, ${groupIdx}, ${fileIdx}, this.checked)">
                                        </label>
                                        <span class="file-path" title="${escapeHtml(file.path)}">📁 ${escapeHtml(file.path)}</span>
                                    </div>
                                    <div class="file-specs">
                                        ${isBest ? `<span class="spec-badge spec-best">★ Keep (Best)</span>` : ''}
                                        ${resLabel ? `<span class="spec-badge ${resLabel.includes('4K') ? 'spec-4k' : ''}">${resLabel}</span>` : ''}
                                        ${sizeFormatted ? `<span class="spec-badge spec-size">${sizeFormatted}</span>` : ''}
                                        ${file.container ? `<span class="spec-badge">${escapeHtml(file.container.toUpperCase())}</span>` : ''}
                                    </div>
                                </div>
                                <div class="file-actions">
                                    <button class="btn-secondary btn-sm" onclick="copyFilePath('${encodeURIComponent(file.path)}')">
                                        📋 Copy
                                    </button>
                                    <button class="btn-danger btn-sm" onclick="promptDelete(${libIdx}, ${groupIdx}, ${fileIdx})">
                                        🗑️ Delete
                                    </button>
                                </div>
                            </div>
                        `;
                    }).join('')}
                </div>
            </div>
        `;
    }).join('');
}

// Selection Management
function toggleFileSelection(libIdx, groupIdx, fileIdx, isChecked) {
    const key = `${libIdx}_${groupIdx}_${fileIdx}`;
    if (isChecked) {
        appState.selectedFiles.add(key);
    } else {
        appState.selectedFiles.delete(key);
    }

    const row = document.getElementById(`file-${libIdx}-${groupIdx}-${fileIdx}`);
    if (row) {
        row.classList.toggle('is-selected', isChecked);
        const chk = row.querySelector('.file-checkbox');
        if (chk) chk.checked = isChecked;
    }

    updateSelectionUI();
}

function smartSelectKeepBest() {
    appState.selectedFiles.clear();
    let selectedCount = 0;
    let totalBytes = 0;

    appState.results.forEach((lib, libIdx) => {
        lib.duplicateGroups.forEach((group, groupIdx) => {
            if (group.files.length > 1) {
                const bestIdx = getBestFileIndex(group.files);
                group.files.forEach((file, fileIdx) => {
                    if (fileIdx !== bestIdx) {
                        const key = `${libIdx}_${groupIdx}_${fileIdx}`;
                        appState.selectedFiles.add(key);
                        selectedCount++;
                        totalBytes += (file.size || 0);
                    }
                });
            }
        });
    });

    displayResults();
    handleSearchFilter();
    updateSelectionUI();
    showToast(`★ Smart Selected ${selectedCount} lower-quality copies (${formatBytes(totalBytes)} reclaimable)!`, 'success');
}

function selectAllDuplicates() {
    appState.selectedFiles.clear();
    appState.results.forEach((lib, libIdx) => {
        lib.duplicateGroups.forEach((group, groupIdx) => {
            group.files.forEach((_, fileIdx) => {
                appState.selectedFiles.add(`${libIdx}_${groupIdx}_${fileIdx}`);
            });
        });
    });

    displayResults();
    handleSearchFilter();
    updateSelectionUI();
    showToast(`Selected all ${appState.selectedFiles.size} duplicate items!`, 'info');
}

function deselectAllDuplicates() {
    appState.selectedFiles.clear();
    displayResults();
    handleSearchFilter();
    updateSelectionUI();
    showToast('Deselected all files.', 'info');
}

function updateSelectionUI() {
    const bar = document.getElementById('selection-bar');
    const countBadge = document.getElementById('selectedCountBadge');
    const sizeBadge = document.getElementById('selectedSizeBadge');
    const deleteBtn = document.getElementById('btnDeleteSelected');

    if (!bar) return;

    const count = appState.selectedFiles.size;
    let totalBytes = 0;

    appState.selectedFiles.forEach(key => {
        const [l, g, f] = key.split('_').map(Number);
        const file = appState.results[l]?.duplicateGroups[g]?.files[f];
        if (file && file.size) {
            totalBytes += file.size;
        }
    });

    countBadge.textContent = `${count} ${count === 1 ? 'file' : 'files'} selected`;
    sizeBadge.textContent = formatBytes(totalBytes);

    if (count > 0) {
        deleteBtn.disabled = false;
        deleteBtn.innerHTML = `<span>🗑️</span> Delete Selected (${count})`;
    } else {
        deleteBtn.disabled = true;
        deleteBtn.innerHTML = `<span>🗑️</span> Delete Selected`;
    }
}

// Accordion Controls
function toggleLibraryAccordion(libIdx) {
    const content = document.getElementById(`library-content-${libIdx}`);
    const arrow = document.getElementById(`accordion-arrow-${libIdx}`);
    content.classList.toggle('hidden');
    arrow.textContent = content.classList.contains('hidden') ? '►' : '▼';
}

function expandAllLibraries() {
    appState.results.forEach((_, idx) => {
        const content = document.getElementById(`library-content-${idx}`);
        const arrow = document.getElementById(`accordion-arrow-${idx}`);
        if (content) content.classList.remove('hidden');
        if (arrow) arrow.textContent = '▼';
    });
}

function collapseAllLibraries() {
    appState.results.forEach((_, idx) => {
        const content = document.getElementById(`library-content-${idx}`);
        const arrow = document.getElementById(`accordion-arrow-${idx}`);
        if (content) content.classList.add('hidden');
        if (arrow) arrow.textContent = '►';
    });
}

// Live Search Filter
function handleSearchFilter() {
    const term = document.getElementById('searchFilter').value.trim().toLowerCase();

    appState.results.forEach((lib, libIdx) => {
        let visibleCountInLib = 0;
        lib.duplicateGroups.forEach((group, groupIdx) => {
            const card = document.getElementById(`group-${libIdx}-${groupIdx}`);
            if (!card) return;

            const matches = group.title.toLowerCase().includes(term) ||
                group.files.some(f => f.path.toLowerCase().includes(term));

            if (matches) {
                card.classList.remove('hidden');
                visibleCountInLib++;
            } else {
                card.classList.add('hidden');
            }
        });

        const libBox = document.getElementById(`library-box-${libIdx}`);
        if (libBox) {
            libBox.style.display = (visibleCountInLib > 0 || term === '') ? '' : 'none';
        }
    });
}

// Delete Item Flow
function promptDelete(libIdx, groupIdx, fileIdx) {
    const library = appState.results[libIdx];
    const group = library.duplicateGroups[groupIdx];
    const file = group.files[fileIdx];

    appState.pendingDelete = {
        libIdx,
        groupIdx,
        fileIdx,
        itemId: file.itemId,
        itemTitle: group.title,
        path: file.path,
        libraryName: library.libraryName
    };

    document.getElementById('deleteModalTitle').textContent = group.title;
    document.getElementById('deleteModalLibrary').textContent = library.libraryName;
    document.getElementById('deleteModalPath').textContent = file.path;

    document.getElementById('delete-modal').classList.remove('hidden');
}

function closeDeleteModal() {
    document.getElementById('delete-modal').classList.add('hidden');
    appState.pendingDelete = null;
}

async function executeDelete() {
    if (!appState.pendingDelete) return;

    const { libIdx, groupIdx, fileIdx, itemId, itemTitle, path } = appState.pendingDelete;
    const confirmBtn = document.getElementById('confirmDeleteBtn');
    confirmBtn.disabled = true;
    confirmBtn.textContent = 'Deleting...';

    try {
        await embyFetch(`/emby/Items/${itemId}?api_key=${appState.apiKey}`, {
            method: 'DELETE'
        });

        showToast(`Successfully deleted: ${itemTitle}`, 'success');
        closeDeleteModal();

        const library = appState.results[libIdx];
        const group = library.duplicateGroups[groupIdx];
        group.files.splice(fileIdx, 1);

        if (group.files.length <= 1) {
            library.duplicateGroups.splice(groupIdx, 1);
            library.count = library.duplicateGroups.length;
        }

        appState.selectedFiles.delete(`${libIdx}_${groupIdx}_${fileIdx}`);

        displayResults();
        handleSearchFilter();
        updateSelectionUI();

    } catch (err) {
        console.error('Delete error:', err);
        showToast(`Delete failed: ${err.message}`, 'error');
        alert(`Deletion Error:\n${err.message}\n\nPlease verify that 'Allow media deletion from clients' is turned ON for your user/API Key in Emby Server Settings.`);
    } finally {
        confirmBtn.disabled = false;
        confirmBtn.textContent = 'Delete Permanently';
    }
}

// Batch Delete Flow
function promptBatchDelete() {
    if (appState.selectedFiles.size === 0) return;
    const modal = document.getElementById('batch-delete-modal');
    const countSpan = document.getElementById('batchDeleteCount');
    const sizeSpan = document.getElementById('batchDeleteSize');
    const list = document.getElementById('batchDeletePreviewList');
    const progressBox = document.getElementById('batchDeleteProgressContainer');

    progressBox.classList.add('hidden');
    list.innerHTML = '';

    let totalBytes = 0;
    appState.selectedFiles.forEach(key => {
        const [l, g, f] = key.split('_').map(Number);
        const group = appState.results[l]?.duplicateGroups[g];
        const file = group?.files[f];
        if (file) {
            totalBytes += (file.size || 0);
            const li = document.createElement('li');
            li.className = 'batch-preview-item';
            li.innerHTML = `<span><strong>${escapeHtml(group.title)}:</strong> <code>${escapeHtml(file.path)}</code></span>
                            <span class="batch-preview-size">${file.size ? formatBytes(file.size) : ''}</span>`;
            list.appendChild(li);
        }
    });

    countSpan.textContent = appState.selectedFiles.size;
    sizeSpan.textContent = formatBytes(totalBytes);
    modal.classList.remove('hidden');
}

function closeBatchDeleteModal() {
    document.getElementById('batch-delete-modal').classList.add('hidden');
}

async function executeBatchDelete() {
    const confirmBtn = document.getElementById('confirmBatchDeleteBtn');
    const cancelBtn = document.getElementById('cancelBatchDeleteBtn');
    const progressBox = document.getElementById('batchDeleteProgressContainer');
    const progressBar = document.getElementById('batchDeleteProgressBar');
    const progressText = document.getElementById('batchDeleteProgressText');

    confirmBtn.disabled = true;
    cancelBtn.disabled = true;
    progressBox.classList.remove('hidden');

    const keysToDelete = Array.from(appState.selectedFiles);
    const total = keysToDelete.length;
    let completed = 0;
    let errorCount = 0;

    for (let i = 0; i < total; i++) {
        const key = keysToDelete[i];
        const [l, g, f] = key.split('_').map(Number);
        const file = appState.results[l]?.duplicateGroups[g]?.files[f];
        if (file) {
            try {
                await embyFetch(`/emby/Items/${file.itemId}?api_key=${appState.apiKey}`, {
                    method: 'DELETE'
                });
            } catch (e) {
                console.error('Delete error for item:', file.itemId, e);
                errorCount++;
            }
        }
        completed++;
        const percent = Math.round((completed / total) * 100);
        progressBar.style.width = `${percent}%`;
        progressText.textContent = `Deleting ${completed} of ${total} files (${percent}%)...`;
    }

    // Sort descending by indices so deletions do not distort array indices
    keysToDelete.sort((a, b) => {
        const [l1, g1, f1] = a.split('_').map(Number);
        const [l2, g2, f2] = b.split('_').map(Number);
        if (l1 !== l2) return l2 - l1;
        if (g1 !== g2) return g2 - g1;
        return f2 - f1;
    });

    keysToDelete.forEach(key => {
        const [l, g, f] = key.split('_').map(Number);
        const group = appState.results[l]?.duplicateGroups[g];
        if (group && group.files[f]) {
            group.files.splice(f, 1);
        }
    });

    // Clean up groups that have <= 1 file
    appState.results.forEach(lib => {
        lib.duplicateGroups = lib.duplicateGroups.filter(g => g.files.length > 1);
        lib.count = lib.duplicateGroups.length;
    });

    appState.selectedFiles.clear();
    confirmBtn.disabled = false;
    cancelBtn.disabled = false;
    closeBatchDeleteModal();

    displayResults();
    handleSearchFilter();
    updateSelectionUI();

    if (errorCount === 0) {
        showToast(`🎉 Successfully batch deleted ${total} files!`, 'success');
    } else {
        showToast(`Batch delete completed: ${total - errorCount} deleted, ${errorCount} failed.`, 'warning');
    }
}

// Download Report File (.txt)
function downloadLibraryReport(libIdx) {
    const lib = appState.results[libIdx];
    if (!lib) return;

    let content = `=====================================================\n`;
    content += `Emby Duplicate Report: ${lib.libraryName} (${lib.type.toUpperCase()})\n`;
    content += `Generated on: ${new Date().toLocaleString()}\n`;
    content += `Total Duplicate Groups: ${lib.duplicateGroups.length}\n`;
    content += `=====================================================\n\n`;

    lib.duplicateGroups.forEach((g, idx) => {
        content += `[${idx + 1}] ${g.title} (${g.year || 'N/A'})\n`;
        content += `Total Copies: ${g.files.length}\n`;
        g.files.forEach((f, fIdx) => {
            const size = f.size ? ` [${formatBytes(f.size)}]` : '';
            const res = getResolutionLabel(f.width, f.height) ? ` [${getResolutionLabel(f.width, f.height)}]` : '';
            content += `   (${fIdx + 1}) Path: ${f.path}${res}${size}\n`;
        });
        content += `\n`;
    });

    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${lib.libraryName.replace(/[^a-z0-9]/gi, '_')}_duplicates_report.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// Helper: Resolution Label
function getResolutionLabel(width, height) {
    if (!width && !height) return '';
    const maxDim = Math.max(width || 0, height || 0);
    if (maxDim >= 3800) return '4K UHD';
    if (maxDim >= 1900) return '1080p FHD';
    if (maxDim >= 1200) return '720p HD';
    if (maxDim > 0) return 'SD';
    return '';
}

// Helper: Format Bytes to MB/GB
function formatBytes(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Helper: Safe HTML Escaping
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Helper: Toast Notifications
function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;

    let icon = 'ℹ️';
    if (type === 'success') icon = '✅';
    if (type === 'error') icon = '❌';
    if (type === 'warning') icon = '⚠️';

    toast.innerHTML = `<span>${icon}</span> <span>${escapeHtml(message)}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transition = 'opacity 0.3s ease';
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}

// Copy file path to clipboard
async function copyFilePath(encodedPath) {
    const rawPath = decodeURIComponent(encodedPath);
    try {
        await navigator.clipboard.writeText(rawPath);
        showToast('File path copied to clipboard!', 'success');
    } catch (e) {
        const textarea = document.createElement('textarea');
        textarea.value = rawPath;
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
        showToast('File path copied to clipboard!', 'success');
    }
}

// Plugin Install Guide Modal Handlers
function openPluginInstallGuide() {
    const modal = document.getElementById('plugin-modal');
    if (modal) modal.classList.remove('hidden');
}

function closePluginInstallGuide() {
    const modal = document.getElementById('plugin-modal');
    if (modal) modal.classList.add('hidden');
}

// Scroll to Top Handler
document.addEventListener('DOMContentLoaded', () => {
    const scrollToTopBtn = document.getElementById('scrollToTopBtn');
    if (!scrollToTopBtn) return;

    window.addEventListener('scroll', () => {
        if (window.scrollY > 280) {
            scrollToTopBtn.classList.add('visible');
        } else {
            scrollToTopBtn.classList.remove('visible');
        }
    }, { passive: true });

    scrollToTopBtn.addEventListener('click', () => {
        window.scrollTo({
            top: 0,
            behavior: 'smooth'
        });
    });
});
