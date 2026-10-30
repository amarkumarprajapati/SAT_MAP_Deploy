# Build and install SAT Map

Follow these steps on the Windows PC that has the project source code. The build PC needs an internet connection so npm and Python can download their packages.

## 1. Install build tools

Install these on the build PC:

- Node.js LTS for Windows x64 (includes npm): https://nodejs.org/
- Python 3.10 or newer for Windows x64: https://www.python.org/downloads/windows/

Enable **Add Python to PATH** in the Python installer. After setup, close and reopen PowerShell.

## 2. Open the project folder

In PowerShell, run:

```powershell
Set-Location 'C:\Users\Dell\Documents\SAT'
```

If the project is elsewhere, substitute its actual folder path.

## 3. Build the installer

Run this one command:

```powershell
powershell -ExecutionPolicy Bypass -File .\build_exe.ps1
```

The script builds the backend, OSINT service, and frontend, then packages them into an installer. The first build can take several minutes while packages download. Wait until it reports success.

## 4. Find the installer

The finished installer is:

```text
SAT_Build\release\SAT Map Setup.exe
```

Copy only **SAT Map Setup.exe** to the other PC. Files under `SAT_Build\internal` are build inputs and temporary service files; do not launch or distribute them separately.

## 5. Install and run on the other PC

The target PC must run 64-bit Windows. It does not need Node.js, Python, npm, or the source project.

1. Copy `SAT Map Setup.exe` to the target PC and double-click it.
2. Follow the installer prompts.
3. Open SAT Map from the desktop shortcut or Start menu.
4. The app shows OSINT, backend, and frontend startup status, then opens the map after the services respond. Service consoles stay hidden. API snapshots persist in a local SQLite file.

The app uses local ports 7890 (frontend), 8569 (backend), and 15673 (OSINT); those ports must be free. Live data requires internet. Windows may show a SmartScreen warning because the installer is not code-signed.

## Database behavior

The app stores API snapshots in `data/sat_map.sqlite3` beside its bundled services. SQLite is included with Python, so no external database server is needed.

## If the build fails

Make sure Node.js, npm, and Python are available in a newly opened PowerShell and that the build PC has internet access. Read the first error from the script, resolve the missing tool or failed download, then rerun the build command. The installer is created only after all build steps complete successfully.
