# Emby Duplicate Finder

A modern, fast web-based tool designed to help Emby users identify, compare, and manage duplicate movies and TV series across their libraries.

---

## 🚀 Features

- **Movies & TV Series Support**: Scans movie libraries, series, and episode files.
- **Smart Duplicate Detection**:
  - Matches by **IMDb & TMDb IDs** (detects misidentified or renamed files).
  - Matches by **Title & Production Year**.
  - Identifies **Multi-Version Files** (multiple files attached to a single item).
- **Quality Comparison**:
  - Compares Resolution (4K UHD, 1080p, 720p, SD), Video Codec, Audio Specs, File Size, and Bitrate.
  - Automatically highlights the **★ Best Quality (Recommended Keep)** copy.
- **Direct Management & Deletion**:
  - Safely delete redundant duplicate files directly from the UI with interactive confirmation prompts.
  - Direct links to open and inspect items in Emby.
  - One-click file path copying.
- **CORS & Reverse Proxy Support**:
  - Built-in CORS proxy option for connecting to HTTP Emby servers from HTTPS pages.
- **Export Reports**:
  - Download complete duplicate audit reports in **TXT** format.

---

## 🌐 How to Use

1. Open `index.html` in your web browser, or visit the live demo:
   [https://sohag1192.github.io/emby-duplicate-finder/](https://sohag1192.github.io/emby-duplicate-finder/)
2. Enter your Emby Server URL (e.g. `http://192.168.1.100:8096` or `https://emby.yourdomain.com`).
3. Enter your Emby Admin API Key.
4. Select your library type (Movies, TV Shows, or All).
5. Click **Find Duplicate Media**.

---

## 💡 Inspiration & Acknowledgements

This project was inspired by [imahmud1/emby-dupe-finder](https://github.com/imahmud1/emby-dupe-finder). Special thanks to the author for the concept and inspiration!

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).
