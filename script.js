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

        function checkIsTvLib(lib) {
            const ct = (lib.CollectionType || '').toLowerCase();
            const nm = (lib.Name || '').toLowerCase();
            return ct === 'tvshows' || ct === 'series' || ct === 'tv' || 
                   nm.includes('tv') || nm.includes('series') || nm.includes('show') || nm.includes('anime') || nm.includes('serial');
        }

        function checkIsMovieLib(lib) {
            const ct = (lib.CollectionType || '').toLowerCase();
            const nm = (lib.Name || '').toLowerCase();
            return ct === 'movies' || ct === 'movie' || ct === 'films' || 
                   nm.includes('movie') || nm.includes('film') || nm.includes('cinema');
        }

        let filteredLibraries = [];
        if (libraryType === 'movies') {
            filteredLibraries = libraries.filter(lib => checkIsMovieLib(lib) || (!checkIsTvLib(lib) && !lib.CollectionType));
        } else if (libraryType === 'tvshows') {
            filteredLibraries = libraries.filter(lib => checkIsTvLib(lib));
            if (filteredLibraries.length === 0) {
                filteredLibraries = libraries.filter(lib => !checkIsMovieLib(lib));
            }
        } else {
            // All: all video libraries (movies, tv, unclassified, mixed)
            filteredLibraries = libraries.filter(lib => {
                const ct = (lib.CollectionType || '').toLowerCase();
                return ct !== 'music' && ct !== 'books' && ct !== 'photos' && ct !== 'audiobooks';
            });
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
            const isTv = checkIsTvLib(library);
            const isMovie = checkIsMovieLib(library);

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
            } else if (isMovie) {
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
            } else {
                // Mixed or Unclassified Library: Scan both Movies and TV Episodes
                const movies = await fetchMoviesFromLibrary(library.ItemId);
                const movieDupes = findDuplicatesInMovieLibrary(movies);
                if (movieDupes.length > 0) {
                    duplicateResults.push({
                        libraryId: library.ItemId,
                        libraryName: `${library.Name} (Movies)`,
                        type: 'movies',
                        duplicateGroups: movieDupes,
                        count: movieDupes.length
                    });
                }

                const episodes = await fetchEpisodesFromLibrary(library.ItemId);
                const tvDupes = findDuplicatesInTvLibrary(episodes);
                if (tvDupes.length > 0) {
                    duplicateResults.push({
                        libraryId: library.ItemId,
                        libraryName: `${library.Name} (TV Episodes)`,
                        type: 'tvshows',
                        duplicateGroups: tvDupes,
                        count: tvDupes.length
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

// Stats Calculation (null-safe)
function calculateStats() {
    let totalGroups = 0;
    let reclaimableBytes = 0;

    appState.results.forEach(lib => {
        if (!lib.duplicateGroups) return;
        totalGroups += lib.duplicateGroups.length;
        lib.duplicateGroups.forEach(group => {
            if (group.files && group.files.length > 1) {
                const sizes = group.files.map(f => f.size || 0).filter(s => s > 0);
                if (sizes.length > 1) {
                    const totalGroupSize = sizes.reduce((a, b) => a + b, 0);
                    const maxSize = Math.max(...sizes);
                    reclaimableBytes += (totalGroupSize - maxSize);
                }
            }
        });
    });

    const statLibs = document.getElementById('stat-libraries');
    const statDupes = document.getElementById('stat-duplicates');
    const statSpace = document.getElementById('stat-space');

    if (statLibs) statLibs.textContent = appState.results.length;
    if (statDupes) statDupes.textContent = totalGroups.toLocaleString();
    if (statSpace) statSpace.textContent = reclaimableBytes > 0 ? formatBytes(reclaimableBytes) : '0 B';
}

// API: Fetch Virtual Folders / Libraries
async function fetchLibraries() {
    const response = await embyFetch(`/emby/Library/VirtualFolders?api_key=${appState.apiKey}`);
    return await response.json();
}

// API: Fetch Movies
async function fetchMoviesFromLibrary(libraryId) {
    const fields = 'Path,ProductionYear,MediaSources,Width,Height,Size,Container,ParentId';
    const response = await embyFetch(`/emby/Items?Recursive=true&ParentId=${libraryId}&IncludeItemTypes=Movie&Fields=${fields}&api_key=${appState.apiKey}`);
    const data = await response.json();
    return data.Items || [];
}

// API: Fetch Episodes
async function fetchEpisodesFromLibrary(libraryId) {
    const fields = 'Path,SeriesName,SeasonName,IndexNumber,ParentIndexNumber,ProductionYear,MediaSources,Width,Height,Size,Container,SeriesId,SeasonId,ParentId';
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
                    parentId: movie.ParentId,
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
                parentId: movie.ParentId,
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

// Helper: Parse Season & Episode from filename or path if Emby metadata is missing
function parseEpisodeInfoFromPath(filePath) {
    if (!filePath) return null;
    const fileName = filePath.split(/[\\/]/).pop() || '';

    // S01E02 or S1E2 or S01.E02
    let match = fileName.match(/[sS](\d{1,2})[.\-_ ]*[eE](\d{1,3})/);
    if (match) {
        return { season: parseInt(match[1], 10), episode: parseInt(match[2], 10) };
    }

    // 1x02 or 01x02
    match = fileName.match(/(\d{1,2})x(\d{1,3})/i);
    if (match) {
        return { season: parseInt(match[1], 10), episode: parseInt(match[2], 10) };
    }

    // E02 or EP02
    match = fileName.match(/(?:^|[.\-_ ])[eE][pP]?(\d{1,3})(?:[.\-_ ]|$)/);
    if (match) {
        const sMatch = filePath.match(/[sS](?:eason)?[.\-_ ]*(\d{1,2})/i);
        const sNum = sMatch ? parseInt(sMatch[1], 10) : 1;
        return { season: sNum, episode: parseInt(match[1], 10) };
    }

    return null;
}

// Helper: Extract Series name from directory structure if missing
function extractSeriesNameFromPath(filePath) {
    if (!filePath) return null;
    const parts = filePath.split(/[\\/]/).filter(Boolean);
    if (parts.length >= 3) {
        const parent = parts[parts.length - 2];
        if (/season|s\d+/i.test(parent) && parts.length >= 4) {
            return parts[parts.length - 3];
        }
        return parent;
    }
    return null;
}

// Helper: Split Directory Path and File Name cleanly
function splitDirectoryAndFileName(fullPath) {
    if (!fullPath || fullPath === 'Unknown path') {
        return { dir: '', file: fullPath || 'Unknown path' };
    }
    const lastSlash = Math.max(fullPath.lastIndexOf('/'), fullPath.lastIndexOf('\\'));
    if (lastSlash === -1) {
        return { dir: '', file: fullPath };
    }
    return {
        dir: fullPath.substring(0, lastSlash + 1),
        file: fullPath.substring(lastSlash + 1)
    };
}

// Duplicate Detection: TV Series / Episodes
function findDuplicatesInTvLibrary(episodes) {
    const groups = {};

    episodes.forEach(ep => {
        let seriesName = ep.SeriesName;
        let season = ep.ParentIndexNumber;
        let episodeNum = ep.IndexNumber;
        const filePath = ep.Path || (ep.MediaSources && ep.MediaSources[0] ? ep.MediaSources[0].Path : '') || '';

        // If Season or Episode is missing, parse from file path / file name
        if ((season === undefined || episodeNum === undefined) && filePath) {
            const parsed = parseEpisodeInfoFromPath(filePath);
            if (parsed) {
                if (season === undefined) season = parsed.season;
                if (episodeNum === undefined) episodeNum = parsed.episode;
            }
        }

        // If SeriesName is missing, extract from directory folder name
        if (!seriesName && filePath) {
            seriesName = extractSeriesNameFromPath(filePath) || 'Unknown Series';
        } else if (!seriesName) {
            seriesName = 'Unknown Series';
        }

        let key = '';
        let displayTitle = '';

        if (season !== undefined && episodeNum !== undefined) {
            const sPad = String(season).padStart(2, '0');
            const ePad = String(episodeNum).padStart(2, '0');
            key = `${seriesName.trim().toLowerCase()}_s${sPad}e${ePad}`;
            const epName = ep.Name ? ` - ${ep.Name}` : '';
            displayTitle = `${seriesName} - S${sPad}E${ePad}${epName}`;
        } else {
            // Unparsed episode: group by series and sanitized file name to avoid grouping all unknown episodes together
            const baseFileName = filePath ? (filePath.split(/[\\/]/).pop() || '').replace(/\.[^/.]+$/, '').trim().toLowerCase() : '';
            const epNameClean = (ep.Name || '').trim().toLowerCase();
            const identifier = baseFileName || epNameClean || ep.Id;
            key = `${seriesName.trim().toLowerCase()}_raw_${identifier}`;
            displayTitle = `${seriesName} - ${ep.Name || (filePath ? filePath.split(/[\\/]/).pop() : 'Episode')}`;
        }

        if (!groups[key]) {
            groups[key] = {
                title: displayTitle,
                year: ep.ProductionYear,
                type: 'episode',
                seriesName: seriesName,
                seriesId: ep.SeriesId,
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
                    parentId: ep.ParentId,
                    seasonId: ep.SeasonId,
                    seriesId: ep.SeriesId,
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
                parentId: ep.ParentId,
                seasonId: ep.SeasonId,
                seriesId: ep.SeriesId,
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
                const normPath = (f.path || '').trim().toLowerCase();
                const pKey = `${f.itemId}_${normPath}`;
                if (!seenPaths.has(pKey)) {
                    seenPaths.add(pKey);
                    uniqueFiles.push(f);
                }
            }
            // Only flag as duplicates if there are multiple DIFFERENT physical paths on disk
            const distinctPaths = new Set(uniqueFiles.map(f => (f.path || '').trim().toLowerCase()));
            if (uniqueFiles.length > 1 && distinctPaths.size > 1) {
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
    if (!resultsDiv) return;
    resultsDiv.innerHTML = '';

    // Filter out libraries that have 0 duplicates
    appState.results = appState.results.filter(lib => lib.duplicateGroups && lib.duplicateGroups.length > 0);

    if (appState.results.length === 0) {
        resultsDiv.innerHTML = `
            <div class="card text-center" style="padding: 40px 20px;">
                <div style="font-size: 48px; margin-bottom: 12px;">🎉</div>
                <h3 style="margin-bottom: 8px; color: #10b981;">All Duplicates Resolved!</h3>
                <p class="helper-text" style="max-width: 500px; margin: 0 auto 20px auto;">
                    Great news! There are no remaining duplicate movies or TV episodes in your scanned libraries.
                </p>
                <button class="btn-primary" onclick="findDuplicates()" style="display: inline-flex; align-items: center; gap: 8px;">
                    🔄 Re-Scan Libraries to Verify
                </button>
            </div>`;
        const selBar = document.getElementById('selection-bar');
        if (selBar) selBar.classList.add('hidden');
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
                    <button class="btn-secondary btn-sm" onclick="event.stopPropagation(); rescanLibrary(${libIdx})" title="Re-scan this library from Emby">
                        🔄 Re-Scan
                    </button>
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
        const posterItemId = (group.type === 'episode' && group.seriesId) ? group.seriesId : group.primaryItemId;
        const posterUrl = `${appState.serverUrl}/emby/Items/${posterItemId}/Images/Primary?maxWidth=150&api_key=${appState.apiKey}`;
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
                        const pathParts = splitDirectoryAndFileName(file.path);

                        return `
                            <div class="file-row ${isSelected ? 'is-selected' : ''}" id="file-${libIdx}-${groupIdx}-${fileIdx}">
                                <div class="file-info">
                                    <div style="display:flex; align-items:flex-start; gap:10px;">
                                        <label class="file-select-checkbox" title="Select for batch delete" style="margin-top: 3px;">
                                            <input type="checkbox" class="file-checkbox" ${isSelected ? 'checked' : ''} onchange="toggleFileSelection(${libIdx}, ${groupIdx}, ${fileIdx}, this.checked)">
                                        </label>
                                        <div class="file-path-wrapper">
                                            ${pathParts.dir ? `<div class="file-dir-row" title="Folder: ${escapeHtml(pathParts.dir)}"><span class="dir-icon">📂</span> <span class="dir-text">${escapeHtml(pathParts.dir)}</span></div>` : ''}
                                            <div class="file-name-row" title="File: ${escapeHtml(pathParts.file)}"><span class="file-icon">📄</span> <strong class="file-name-text">${escapeHtml(pathParts.file)}</strong></div>
                                        </div>
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
                                        📋 Copy Path
                                    </button>
                                    ${pathParts.dir ? `
                                    <button class="btn-warning btn-sm" onclick="promptDeleteFolder(${libIdx}, '${encodeURIComponent(pathParts.dir)}')" title="Delete all duplicate files in this folder: ${escapeHtml(pathParts.dir)}">
                                        📁 Delete Folder
                                    </button>` : ''}
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

    const hasAnyDuplicates = appState.results.some(r => r.duplicateGroups && r.duplicateGroups.length > 0);
    if (bar) {
        if (hasAnyDuplicates) {
            bar.classList.remove('hidden');
        } else {
            bar.classList.add('hidden');
        }
    }

    let totalBytes = 0;
    const invalidKeys = [];
    appState.selectedFiles.forEach(key => {
        const [l, g, f] = key.split('_').map(Number);
        const file = appState.results[l]?.duplicateGroups[g]?.files[f];
        if (file) {
            if (file.size) totalBytes += file.size;
        } else {
            invalidKeys.push(key);
        }
    });

    invalidKeys.forEach(k => appState.selectedFiles.delete(k));

    const count = appState.selectedFiles.size;
    if (countBadge) countBadge.textContent = `${count} ${count === 1 ? 'file' : 'files'} selected`;
    if (sizeBadge) sizeBadge.textContent = formatBytes(totalBytes);

    if (deleteBtn) {
        if (count > 0) {
            deleteBtn.disabled = false;
            deleteBtn.innerHTML = `<span>🗑️</span> Delete Selected (${count})`;
        } else {
            deleteBtn.disabled = true;
            deleteBtn.innerHTML = `<span>🗑️</span> Delete Selected`;
        }
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
    if (!library || !library.duplicateGroups[groupIdx]) return;
    const group = library.duplicateGroups[groupIdx];
    const file = group.files[fileIdx];
    if (!file) return;

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

    const isWindows = file.path.includes('\\');
    const singleCmd = isWindows ? `del /f /q "${file.path}"` : `rm -f "${file.path}"`;
    const singleCmdElem = document.getElementById('singleFileDeleteCmdText');
    if (singleCmdElem) singleCmdElem.textContent = singleCmd;

    document.getElementById('delete-modal').classList.remove('hidden');
}

function copySingleFileDeleteCmd() {
    if (!appState.pendingDelete || !appState.pendingDelete.path) return;
    const filePath = appState.pendingDelete.path;
    const isWindows = filePath.includes('\\');
    const cmd = isWindows ? `del /f /q "${filePath}"` : `rm -f "${filePath}"`;
    navigator.clipboard.writeText(cmd).then(() => {
        showToast(`📋 Copied command: ${cmd}`, 'success');
    }).catch(() => {
        prompt('Copy delete command:', cmd);
    });
}

function closeDeleteModal() {
    const modal = document.getElementById('delete-modal');
    if (modal) modal.classList.add('hidden');
    appState.pendingDelete = null;
}

async function executeDelete() {
    if (!appState.pendingDelete) return;

    const { libIdx, groupIdx, fileIdx, itemId, itemTitle } = appState.pendingDelete;
    const confirmBtn = document.getElementById('confirmDeleteBtn');
    if (confirmBtn) {
        confirmBtn.disabled = true;
        confirmBtn.textContent = 'Deleting...';
    }

    try {
        await embyFetch(`/emby/Items/${itemId}?api_key=${appState.apiKey}`, {
            method: 'DELETE'
        });

        showToast(`Successfully deleted: ${itemTitle}`, 'success');

        const library = appState.results[libIdx];
        if (library && library.duplicateGroups[groupIdx]) {
            const group = library.duplicateGroups[groupIdx];
            group.files.splice(fileIdx, 1);

            if (group.files.length <= 1) {
                library.duplicateGroups.splice(groupIdx, 1);
            }
            library.count = library.duplicateGroups.length;
        }

        // Clean up empty libraries and reset selections
        appState.results = appState.results.filter(lib => lib.duplicateGroups && lib.duplicateGroups.length > 0);
        appState.selectedFiles.clear();

    } catch (err) {
        console.error('Delete error:', err);
        showToast(`Delete failed: ${err.message}`, 'error');
        alert(`Deletion Error:\n${err.message}\n\nPlease verify that 'Allow media deletion from clients' is turned ON for your user/API Key in Emby Server Settings.`);
    } finally {
        closeDeleteModal();
        if (confirmBtn) {
            confirmBtn.disabled = false;
            confirmBtn.textContent = 'Delete Permanently';
        }
        if (typeof calculateStats === 'function') calculateStats();
        displayResults();
        handleSearchFilter();
        updateSelectionUI();
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

    if (confirmBtn) confirmBtn.disabled = true;
    if (cancelBtn) cancelBtn.disabled = true;
    if (progressBox) progressBox.classList.remove('hidden');

    const keysToDelete = Array.from(appState.selectedFiles);
    const total = keysToDelete.length;
    let completed = 0;
    let errorCount = 0;

    try {
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
            const percent = total > 0 ? Math.round((completed / total) * 100) : 100;
            if (progressBar) progressBar.style.width = `${percent}%`;
            if (progressText) progressText.textContent = `Deleting ${completed} of ${total} files (${percent}%)...`;
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

        // Filter out empty libraries
        appState.results = appState.results.filter(lib => lib.duplicateGroups && lib.duplicateGroups.length > 0);
        appState.selectedFiles.clear();

        if (errorCount === 0) {
            showToast(`🎉 Successfully batch deleted ${total} files!`, 'success');
        } else {
            showToast(`Batch delete completed: ${total - errorCount} deleted, ${errorCount} failed.`, 'warning');
        }
    } catch (fatalErr) {
        console.error('Fatal batch delete error:', fatalErr);
        showToast(`Batch delete error: ${fatalErr.message}`, 'error');
    } finally {
        if (confirmBtn) confirmBtn.disabled = false;
        if (cancelBtn) cancelBtn.disabled = false;
        closeBatchDeleteModal();

        if (typeof calculateStats === 'function') calculateStats();
        displayResults();
        handleSearchFilter();
        updateSelectionUI();
    }
}

// Path & Directory Helpers
function getDirectoryFromPath(filePath) {
    if (!filePath || filePath === 'Unknown path') return '';
    const lastSlash = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
    if (lastSlash === -1) return '';
    return filePath.substring(0, lastSlash);
}

function getFileNameFromPath(filePath) {
    if (!filePath || filePath === 'Unknown path') return filePath || '';
    const lastSlash = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
    if (lastSlash === -1) return filePath;
    return filePath.substring(lastSlash + 1);
}

function getDuplicateFilesInFolder(libIdx, targetDir) {
    const lib = appState.results[libIdx];
    if (!lib) return [];
    const filesInFolder = [];

    // Normalize comparison target
    const cleanTarget = targetDir.replace(/[\\/]+$/, '').toLowerCase();

    lib.duplicateGroups.forEach((group, groupIdx) => {
        group.files.forEach((file, fileIdx) => {
            const fileDir = getDirectoryFromPath(file.path).toLowerCase();
            if (fileDir === cleanTarget) {
                filesInFolder.push({
                    libIdx,
                    groupIdx,
                    fileIdx,
                    file,
                    groupTitle: group.title
                });
            }
        });
    });

    return filesInFolder;
}

function getUniqueDuplicateFolders() {
    const folderMap = new Map();

    appState.results.forEach((lib, libIdx) => {
        lib.duplicateGroups.forEach((group, groupIdx) => {
            group.files.forEach((file, fileIdx) => {
                const dir = getDirectoryFromPath(file.path);
                if (!dir) return;
                const key = `${libIdx}:::${dir.toLowerCase()}`;
                if (!folderMap.has(key)) {
                    folderMap.set(key, {
                        libIdx,
                        libName: lib.libraryName,
                        dirPath: dir,
                        files: [],
                        totalBytes: 0
                    });
                }
                const entry = folderMap.get(key);
                entry.files.push({ libIdx, groupIdx, fileIdx, file, groupTitle: group.title });
                entry.totalBytes += (file.size || 0);
            });
        });
    });

    return Array.from(folderMap.values());
}

// Folder Deletion Flow
let pendingFolderDelete = null;

function promptDeleteFolder(libIdx, encodedDirPath) {
    const dirPath = decodeURIComponent(encodedDirPath);
    const files = getDuplicateFilesInFolder(libIdx, dirPath);
    if (files.length === 0) {
        showToast('No duplicate files found in this directory.', 'warning');
        return;
    }

    pendingFolderDelete = {
        libIdx,
        dirPath,
        files
    };

    const modal = document.getElementById('folder-delete-modal');
    document.getElementById('folderDeletePath').textContent = dirPath;
    document.getElementById('folderDeleteCount').textContent = files.length;
    
    const totalBytes = files.reduce((acc, item) => acc + (item.file.size || 0), 0);
    document.getElementById('folderDeleteSize').textContent = formatBytes(totalBytes);

    const list = document.getElementById('folderDeletePreviewList');
    list.innerHTML = '';
    files.forEach(item => {
        const li = document.createElement('li');
        li.className = 'batch-preview-item';
        li.innerHTML = `<span><strong>${escapeHtml(item.groupTitle)}:</strong> <code>${escapeHtml(getFileNameFromPath(item.file.path))}</code></span>
                        <span class="batch-preview-size">${item.file.size ? formatBytes(item.file.size) : ''}</span>`;
        list.appendChild(li);
    });

    const isWindows = dirPath.includes('\\');
    const cmd = isWindows ? `rd /s /q "${dirPath}"` : `rm -rf "${dirPath}"`;
    const cmdTextElem = document.getElementById('folderDeleteCmdText');
    if (cmdTextElem) cmdTextElem.textContent = cmd;

    document.getElementById('folderDeleteProgressContainer').classList.add('hidden');
    modal.classList.remove('hidden');
}

function copyFolderDeleteCmd() {
    if (!pendingFolderDelete || !pendingFolderDelete.dirPath) return;
    const isWindows = pendingFolderDelete.dirPath.includes('\\');
    const cmd = isWindows 
        ? `rd /s /q "${pendingFolderDelete.dirPath}"`
        : `rm -rf "${pendingFolderDelete.dirPath}"`;
    navigator.clipboard.writeText(cmd).then(() => {
        showToast(`📋 Copied command to clipboard: ${cmd}`, 'success');
    }).catch(() => {
        prompt('Copy delete command:', cmd);
    });
}

function closeFolderDeleteModal() {
    document.getElementById('folder-delete-modal').classList.add('hidden');
    pendingFolderDelete = null;
}

async function executeDeleteFolder() {
    if (!pendingFolderDelete) return;

    const { libIdx, dirPath, files } = pendingFolderDelete;
    const confirmBtn = document.getElementById('confirmFolderDeleteBtn');
    const cancelBtn = document.getElementById('cancelFolderDeleteBtn');
    const progressBox = document.getElementById('folderDeleteProgressContainer');
    const progressBar = document.getElementById('folderDeleteProgressBar');
    const progressText = document.getElementById('folderDeleteProgressText');
    const deletePhysicalFolder = document.getElementById('chkAlsoDeletePhysicalDir')?.checked ?? true;

    if (confirmBtn) confirmBtn.disabled = true;
    if (cancelBtn) cancelBtn.disabled = true;
    if (progressBox) progressBox.classList.remove('hidden');

    const total = files.length;
    let completed = 0;
    let errorCount = 0;

    try {
        // 1. Delete all duplicate media file items in this folder
        for (let i = 0; i < total; i++) {
            const item = files[i];
            try {
                await embyFetch(`/emby/Items/${item.file.itemId}?api_key=${appState.apiKey}`, {
                    method: 'DELETE'
                });
            } catch (e) {
                console.error('Delete error for item in folder:', item.file.itemId, e);
                errorCount++;
            }
            completed++;
            const percent = Math.round((completed / (total + (deletePhysicalFolder ? 1 : 0))) * 100);
            if (progressBar) progressBar.style.width = `${percent}%`;
            if (progressText) progressText.textContent = `Deleting ${completed} of ${total} files in folder (${percent}%)...`;
        }

        // 2. Remove folder item from Emby ONLY if it is a standalone Folder (NEVER Season or Series!)
        if (deletePhysicalFolder) {
            if (progressText) progressText.textContent = `Checking folder reference in Emby...`;
            const cleanDir = dirPath.replace(/[\\/]+$/, '').toLowerCase();
            const library = appState.results[libIdx];

            if (library && library.libraryId) {
                try {
                    // Query only standalone Folder items (NEVER Season or Series)
                    const folderResp = await embyFetch(`/emby/Items?Recursive=true&ParentId=${library.libraryId}&IncludeItemTypes=Folder&Fields=Path&api_key=${appState.apiKey}`);
                    const folderData = await folderResp.json();
                    if (folderData.Items) {
                        for (const item of folderData.Items) {
                            if (item.Type === 'Folder' && item.Path && item.Path.replace(/[\\/]+$/, '').toLowerCase() === cleanDir) {
                                try {
                                    await embyFetch(`/emby/Items/${item.Id}?api_key=${appState.apiKey}`, {
                                        method: 'DELETE'
                                    });
                                } catch (folderDelErr) {
                                    console.warn('Folder item deletion error:', folderDelErr);
                                }
                            }
                        }
                    }
                } catch (err) {
                    console.log('Folder item lookup error:', err);
                }
            }

            // Trigger Emby library refresh to clean ghost references
            try {
                await embyFetch(`/emby/Library/Refresh?api_key=${appState.apiKey}`, {
                    method: 'POST'
                });
            } catch (e) {}

            if (progressBar) progressBar.style.width = '100%';
        }

        // 3. Remove deleted files from duplicateGroups in local state
        const cleanTarget = dirPath.replace(/[\\/]+$/, '').toLowerCase();
        const library = appState.results[libIdx];
        if (library) {
            library.duplicateGroups.forEach(group => {
                group.files = group.files.filter(f => getDirectoryFromPath(f.path).toLowerCase() !== cleanTarget);
            });
            library.duplicateGroups = library.duplicateGroups.filter(g => g.files.length > 1);
            library.count = library.duplicateGroups.length;
        }

        // Filter out empty libraries
        appState.results = appState.results.filter(lib => lib.duplicateGroups && lib.duplicateGroups.length > 0);
        appState.selectedFiles.clear();

        if (errorCount === 0) {
            showToast(`🎉 Successfully deleted all ${total} files in folder!`, 'success');
        } else {
            showToast(`Folder delete finished: ${total - errorCount} deleted, ${errorCount} failed.`, 'warning');
        }

    } catch (fatalErr) {
        console.error('Fatal folder delete error:', fatalErr);
        showToast(`Folder delete error: ${fatalErr.message}`, 'error');
    } finally {
        if (confirmBtn) confirmBtn.disabled = false;
        if (cancelBtn) cancelBtn.disabled = false;
        closeFolderDeleteModal();

        if (typeof calculateStats === 'function') calculateStats();
        displayResults();
        handleSearchFilter();
        updateSelectionUI();
    }
}

// Re-scan a single library from Emby
async function rescanLibrary(libIdx) {
    const library = appState.results[libIdx];
    if (!library || !library.libraryId) return;

    showToast(`Refreshing duplicates for "${library.libraryName}"...`, 'info');
    const isTv = library.type === 'tvshows';

    try {
        let duplicates = [];
        if (isTv) {
            const episodes = await fetchEpisodesFromLibrary(library.libraryId);
            duplicates = findDuplicatesInTvLibrary(episodes);
        } else {
            const movies = await fetchMoviesFromLibrary(library.libraryId);
            duplicates = findDuplicatesInMovieLibrary(movies);
        }

        library.duplicateGroups = duplicates;
        library.count = duplicates.length;

        appState.results = appState.results.filter(lib => lib.duplicateGroups && lib.duplicateGroups.length > 0);
        appState.selectedFiles.clear();

        if (typeof calculateStats === 'function') calculateStats();
        displayResults();
        handleSearchFilter();
        updateSelectionUI();

        showToast(`Refreshed "${library.libraryName}": ${duplicates.length} duplicate groups found.`, 'success');
    } catch (err) {
        console.error('Rescan error:', err);
        showToast(`Failed to refresh library: ${err.message}`, 'error');
    }
}

function selectAllInFolder(libIdx, encodedDirPath) {
    const dirPath = decodeURIComponent(encodedDirPath);
    const files = getDuplicateFilesInFolder(libIdx, dirPath);
    files.forEach(item => {
        appState.selectedFiles.add(`${item.libIdx}_${item.groupIdx}_${item.fileIdx}`);
    });
    displayResults();
    handleSearchFilter();
    updateSelectionUI();
    showToast(`Selected all ${files.length} duplicate files in folder: ${dirPath}`, 'info');
}

// ==========================================
// Batch Folder Selection & Deletion System
// ==========================================
const selectedBatchFolders = new Set(); // Stores directory path strings

function promptManageFolders() {
    const folders = getUniqueDuplicateFolders();
    const modal = document.getElementById('folders-manager-modal');

    if (folders.length === 0) {
        showToast('No folders with duplicate files found.', 'info');
        return;
    }

    // Filter out any stale folder paths
    const currentFolderPaths = new Set(folders.map(f => f.dirPath.toLowerCase()));
    for (const p of selectedBatchFolders) {
        if (!currentFolderPaths.has(p.toLowerCase())) {
            selectedBatchFolders.delete(p);
        }
    }

    renderFoldersManagerList(folders);
    updateBatchFoldersUI(folders);

    modal.classList.remove('hidden');
}

function renderFoldersManagerList(folders) {
    const list = document.getElementById('foldersManagerList');
    if (!list) return;
    list.innerHTML = '';

    const filterTerm = (document.getElementById('foldersFilterInput')?.value || '').trim().toLowerCase();
    let totalAllBytes = 0;
    let totalAllFiles = 0;

    folders.forEach(f => {
        totalAllBytes += (f.totalBytes || 0);
        totalAllFiles += f.files.length;

        const matches = !filterTerm || f.dirPath.toLowerCase().includes(filterTerm) || f.libName.toLowerCase().includes(filterTerm);
        if (!matches) return;

        const isChecked = selectedBatchFolders.has(f.dirPath);
        const card = document.createElement('div');
        card.className = `folder-manager-card ${isChecked ? 'is-selected' : ''}`;
        card.id = `folder-card-${encodeURIComponent(f.dirPath).replace(/%/g, '_')}`;

        card.innerHTML = `
            <div style="display: flex; align-items: flex-start; gap: 12px; flex: 1; min-width: 260px;">
                <label class="folder-select-checkbox" title="Select folder for batch deletion">
                    <input type="checkbox" class="file-checkbox folder-batch-chk" 
                           ${isChecked ? 'checked' : ''} 
                           onchange="toggleFolderBatchSelection('${encodeURIComponent(f.dirPath)}', this.checked)">
                </label>
                <div class="folder-manager-info">
                    <div class="folder-manager-path">
                        <span style="font-size: 16px;">📁</span>
                        <strong>${escapeHtml(f.dirPath)}</strong>
                    </div>
                    <div class="folder-manager-meta">
                        <span class="meta-chip">${escapeHtml(f.libName)}</span>
                        <span class="meta-chip danger">${f.files.length} Duplicate Files</span>
                        <span class="meta-chip success">${formatBytes(f.totalBytes)}</span>
                    </div>
                </div>
            </div>
            <div class="folder-manager-actions">
                <button type="button" class="btn-secondary btn-sm" onclick="selectAllInFolder(${f.libIdx}, '${encodeURIComponent(f.dirPath)}'); closeFoldersManagerModal();">
                    ☑️ Select Files
                </button>
                <button type="button" class="btn-warning btn-sm" onclick="closeFoldersManagerModal(); promptDeleteFolder(${f.libIdx}, '${encodeURIComponent(f.dirPath)}');">
                    🗑️ Delete Folder
                </button>
            </div>
        `;
        list.appendChild(card);
    });

    const summaryElem = document.getElementById('foldersTotalSummary');
    if (summaryElem) {
        summaryElem.textContent = `Total: ${folders.length} duplicate folders (${totalAllFiles} files • ${formatBytes(totalAllBytes)})`;
    }
}

function handleFoldersFilter() {
    const folders = getUniqueDuplicateFolders();
    renderFoldersManagerList(folders);
}

function toggleFolderBatchSelection(encodedDirPath, isChecked) {
    const dirPath = decodeURIComponent(encodedDirPath);
    if (isChecked) {
        selectedBatchFolders.add(dirPath);
    } else {
        selectedBatchFolders.delete(dirPath);
    }

    const cardId = `folder-card-${encodedDirPath.replace(/%/g, '_')}`;
    const card = document.getElementById(cardId);
    if (card) {
        card.classList.toggle('is-selected', isChecked);
        const chk = card.querySelector('.folder-batch-chk');
        if (chk) chk.checked = isChecked;
    }

    const folders = getUniqueDuplicateFolders();
    updateBatchFoldersUI(folders);
}

function selectAllFoldersForBatch() {
    const folders = getUniqueDuplicateFolders();
    const filterTerm = (document.getElementById('foldersFilterInput')?.value || '').trim().toLowerCase();

    folders.forEach(f => {
        if (!filterTerm || f.dirPath.toLowerCase().includes(filterTerm) || f.libName.toLowerCase().includes(filterTerm)) {
            selectedBatchFolders.add(f.dirPath);
        }
    });

    renderFoldersManagerList(folders);
    updateBatchFoldersUI(folders);
}

function deselectAllFoldersForBatch() {
    selectedBatchFolders.clear();
    const folders = getUniqueDuplicateFolders();
    renderFoldersManagerList(folders);
    updateBatchFoldersUI(folders);
}

function updateBatchFoldersUI(folders = null) {
    if (!folders) folders = getUniqueDuplicateFolders();

    const count = selectedBatchFolders.size;
    let totalBytes = 0;
    let totalFiles = 0;

    folders.forEach(f => {
        if (selectedBatchFolders.has(f.dirPath)) {
            totalBytes += (f.totalBytes || 0);
            totalFiles += f.files.length;
        }
    });

    const badge = document.getElementById('selectedFoldersBadge');
    const sizeBadge = document.getElementById('selectedFoldersSizeBadge');
    const btnTop = document.getElementById('btnBatchDeleteFolders');
    const btnFooter = document.getElementById('btnBatchDeleteFoldersFooter');

    if (badge) badge.textContent = `${count} ${count === 1 ? 'folder' : 'folders'} selected`;
    if (sizeBadge) sizeBadge.textContent = formatBytes(totalBytes);

    const btnText = `🗑️ Delete Selected Folders (${count})`;
    if (btnTop) {
        btnTop.disabled = (count === 0);
        btnTop.innerHTML = btnText;
    }
    if (btnFooter) {
        btnFooter.disabled = (count === 0);
        btnFooter.innerHTML = btnText;
    }
}

function closeFoldersManagerModal() {
    const modal = document.getElementById('folders-manager-modal');
    if (modal) modal.classList.add('hidden');
}

// Batch Folder Delete Confirmation & Execution
function promptBatchDeleteFolders() {
    if (selectedBatchFolders.size === 0) {
        showToast('Please select at least one folder to delete.', 'warning');
        return;
    }

    const folders = getUniqueDuplicateFolders();
    const selectedList = folders.filter(f => selectedBatchFolders.has(f.dirPath));
    if (selectedList.length === 0) return;

    let totalFiles = 0;
    let totalBytes = 0;
    const cmdLines = [];

    const list = document.getElementById('batchFolderPreviewList');
    if (list) list.innerHTML = '';

    selectedList.forEach(item => {
        totalFiles += item.files.length;
        totalBytes += item.totalBytes;

        const isWindows = item.dirPath.includes('\\');
        cmdLines.push(isWindows ? `rd /s /q "${item.dirPath}"` : `rm -rf "${item.dirPath}"`);

        if (list) {
            const li = document.createElement('li');
            li.className = 'batch-preview-item';
            li.innerHTML = `
                <span><strong>📁 ${escapeHtml(item.dirPath)}</strong> (${escapeHtml(item.libName)})</span>
                <span class="batch-preview-size">${item.files.length} files • ${formatBytes(item.totalBytes)}</span>
            `;
            list.appendChild(li);
        }
    });

    const countElem = document.getElementById('batchFolderCount');
    const filesElem = document.getElementById('batchFolderFilesCount');
    const sizeElem = document.getElementById('batchFolderTotalSize');
    const cmdElem = document.getElementById('batchFolderCmdText');
    const progressBox = document.getElementById('batchFolderProgressContainer');

    if (countElem) countElem.textContent = selectedList.length;
    if (filesElem) filesElem.textContent = totalFiles;
    if (sizeElem) sizeElem.textContent = formatBytes(totalBytes);
    if (cmdElem) cmdElem.value = cmdLines.join('\n');
    if (progressBox) progressBox.classList.add('hidden');

    const modal = document.getElementById('batch-folder-delete-modal');
    if (modal) modal.classList.remove('hidden');
}

function copyBatchFolderCmd() {
    const cmdElem = document.getElementById('batchFolderCmdText');
    if (!cmdElem || !cmdElem.value) return;
    const cmd = cmdElem.value;
    navigator.clipboard.writeText(cmd).then(() => {
        showToast(`📋 Copied ${selectedBatchFolders.size} folder delete commands to clipboard!`, 'success');
    }).catch(() => {
        prompt('Copy delete commands:', cmd);
    });
}

function closeBatchFolderDeleteModal() {
    const modal = document.getElementById('batch-folder-delete-modal');
    if (modal) modal.classList.add('hidden');
}

async function executeBatchDeleteFolders() {
    const folders = getUniqueDuplicateFolders();
    const selectedList = folders.filter(f => selectedBatchFolders.has(f.dirPath));
    if (selectedList.length === 0) return;

    const confirmBtn = document.getElementById('confirmBatchFolderBtn');
    const cancelBtn = document.getElementById('cancelBatchFolderBtn');
    const progressBox = document.getElementById('batchFolderProgressContainer');
    const progressBar = document.getElementById('batchFolderProgressBar');
    const progressText = document.getElementById('batchFolderProgressText');
    const deletePhysicalFolder = document.getElementById('chkBatchAlsoDeletePhysicalDir')?.checked ?? true;

    if (confirmBtn) confirmBtn.disabled = true;
    if (cancelBtn) cancelBtn.disabled = true;
    if (progressBox) progressBox.classList.remove('hidden');

    // Gather all files to delete across selected folders
    const allFilesToDelete = [];
    selectedList.forEach(folderItem => {
        folderItem.files.forEach(fObj => {
            allFilesToDelete.push({
                file: fObj.file,
                dirPath: folderItem.dirPath,
                libIdx: folderItem.libIdx
            });
        });
    });

    const total = allFilesToDelete.length;
    let completed = 0;
    let errorCount = 0;

    try {
        // 1. Delete all duplicate media file items across selected folders
        for (let i = 0; i < total; i++) {
            const item = allFilesToDelete[i];
            try {
                await embyFetch(`/emby/Items/${item.file.itemId}?api_key=${appState.apiKey}`, {
                    method: 'DELETE'
                });
            } catch (e) {
                console.error('Delete error for item in batch folder:', item.file.itemId, e);
                errorCount++;
            }
            completed++;
            const percent = Math.round((completed / (total + (deletePhysicalFolder ? selectedList.length : 0))) * 100);
            if (progressBar) progressBar.style.width = `${percent}%`;
            if (progressText) progressText.textContent = `Deleting ${completed} of ${total} files in ${selectedList.length} folders (${percent}%)...`;
        }

        // 2. Remove standalone folder references from Emby if checked
        if (deletePhysicalFolder) {
            if (progressText) progressText.textContent = `Cleaning folder references from Emby library...`;

            for (const folderItem of selectedList) {
                const cleanDir = folderItem.dirPath.replace(/[\\/]+$/, '').toLowerCase();
                const library = appState.results[folderItem.libIdx];

                if (library && library.libraryId) {
                    try {
                        const folderResp = await embyFetch(`/emby/Items?Recursive=true&ParentId=${library.libraryId}&IncludeItemTypes=Folder&Fields=Path&api_key=${appState.apiKey}`);
                        const folderData = await folderResp.json();
                        if (folderData.Items) {
                            for (const item of folderData.Items) {
                                if (item.Type === 'Folder' && item.Path && item.Path.replace(/[\\/]+$/, '').toLowerCase() === cleanDir) {
                                    try {
                                        await embyFetch(`/emby/Items/${item.Id}?api_key=${appState.apiKey}`, {
                                            method: 'DELETE'
                                        });
                                    } catch (folderDelErr) {
                                        console.warn('Folder item deletion error:', folderDelErr);
                                    }
                                }
                            }
                        }
                    } catch (err) {
                        console.log('Folder lookup error:', err);
                    }
                }
            }

            try {
                await embyFetch(`/emby/Library/Refresh?api_key=${appState.apiKey}`, {
                    method: 'POST'
                });
            } catch (e) {}

            if (progressBar) progressBar.style.width = '100%';
        }

        // 3. Remove deleted files from appState.results duplicate groups
        const selectedDirSet = new Set(selectedList.map(f => f.dirPath.replace(/[\\/]+$/, '').toLowerCase()));
        appState.results.forEach(library => {
            library.duplicateGroups.forEach(group => {
                group.files = group.files.filter(file => {
                    const fileDir = getDirectoryFromPath(file.path).replace(/[\\/]+$/, '').toLowerCase();
                    return !selectedDirSet.has(fileDir);
                });
            });
            library.duplicateGroups = library.duplicateGroups.filter(g => g.files.length > 1);
            library.count = library.duplicateGroups.length;
        });

        // Clean up empty libraries
        appState.results = appState.results.filter(lib => lib.duplicateGroups && lib.duplicateGroups.length > 0);
        appState.selectedFiles.clear();
        selectedBatchFolders.clear();

        if (errorCount === 0) {
            showToast(`🎉 Successfully deleted all duplicate files in ${selectedList.length} folders!`, 'success');
        } else {
            showToast(`Batch folder delete finished: ${total - errorCount} deleted, ${errorCount} failed.`, 'warning');
        }

    } catch (fatalErr) {
        console.error('Fatal batch folder delete error:', fatalErr);
        showToast(`Batch folder delete error: ${fatalErr.message}`, 'error');
    } finally {
        if (confirmBtn) confirmBtn.disabled = false;
        if (cancelBtn) cancelBtn.disabled = false;
        closeBatchFolderDeleteModal();

        if (typeof calculateStats === 'function') calculateStats();
        displayResults();
        handleSearchFilter();
        updateSelectionUI();

        // Refresh or close folders manager
        const remainingFolders = getUniqueDuplicateFolders();
        if (remainingFolders.length > 0) {
            renderFoldersManagerList(remainingFolders);
            updateBatchFoldersUI(remainingFolders);
        } else {
            closeFoldersManagerModal();
        }
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

// ==========================================
// Scroll Navigation (Top & Bottom)
// ==========================================
function scrollToTop() {
    window.scrollTo({
        top: 0,
        behavior: 'smooth'
    });
}

function scrollToBottom() {
    window.scrollTo({
        top: Math.max(document.documentElement.scrollHeight, document.body.scrollHeight),
        behavior: 'smooth'
    });
}

function initScrollNavigation() {
    const scrollToTopBtn = document.getElementById('scrollToTopBtn');
    const scrollToBottomBtn = document.getElementById('scrollToBottomBtn');

    function checkScrollPositions() {
        const scrollY = window.scrollY;
        const totalHeight = Math.max(document.documentElement.scrollHeight, document.body.scrollHeight);
        const viewportHeight = window.innerHeight;
        const distanceToBottom = totalHeight - viewportHeight - scrollY;

        // Show 'Scroll to Top' when scrolled down at least 250px
        if (scrollToTopBtn) {
            if (scrollY > 250) {
                scrollToTopBtn.classList.add('visible');
            } else {
                scrollToTopBtn.classList.remove('visible');
            }
        }

        // Show 'Scroll to Bottom' when page has scrollable content and we're not near the bottom (> 200px away)
        if (scrollToBottomBtn) {
            if (totalHeight > viewportHeight + 150 && distanceToBottom > 200) {
                scrollToBottomBtn.classList.add('visible');
            } else {
                scrollToBottomBtn.classList.remove('visible');
            }
        }
    }

    window.addEventListener('scroll', checkScrollPositions, { passive: true });
    window.addEventListener('resize', checkScrollPositions, { passive: true });

    if (scrollToTopBtn) {
        scrollToTopBtn.addEventListener('click', scrollToTop);
    }
    if (scrollToBottomBtn) {
        scrollToBottomBtn.addEventListener('click', scrollToBottom);
    }

    setTimeout(checkScrollPositions, 300);
}

document.addEventListener('DOMContentLoaded', () => {
    initScrollNavigation();
});
