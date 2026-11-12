; Inno Setup script for the Windows installer. Built by scripts/package-win.mjs, which passes
; AppVersion, SourceDir (the staged app folder) and OutputDir on the iscc command line.

#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif

#define LegacyUninstallKey "Software\Microsoft\Windows\CurrentVersion\Uninstall\{{6F1C2B7E-3A55-4C1D-9B0E-BA5EDC0DE001}_is1"

[Setup]
AppId={{6F1C2B7E-3A55-4C1D-9B0E-BA5EDC0DE001}
AppName=BasedCode
AppVersion={#AppVersion}
AppPublisher=Naamloos
AppPublisherURL=https://github.com/Naamloos/BasedCode
AppUpdatesURL=https://github.com/Naamloos/BasedCode/releases
; Program files go to Program Files (read-only for the app). User data (chats, settings, credentials,
; NW.js profile) lives in %LOCALAPPDATA%\BasedCode, which the app picks by default.
DefaultDirName={autopf}\BasedCode
DefaultGroupName=BasedCode
DisableProgramGroupPage=yes
DisableDirPage=auto
PrivilegesRequired=admin
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir={#OutputDir}
OutputBaseFilename=BasedCode-Setup-{#AppVersion}
SetupIconFile={#SourceDir}\BasedCode.ico
UninstallDisplayIcon={app}\BasedCode.exe
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
; The running app is stopped in PrepareToInstall below; Restart Manager cannot close its windowless Node.js processes.
CloseApplications=no
RestartApplications=no

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"

[InstallDelete]
; Replace the app folder wholesale so files removed in a new version do not linger.
Type: filesandordirs; Name: "{app}\app"
Type: filesandordirs; Name: "{app}\nwjs"
; Versions up to 0.1.0 installed per-user into the data folder. Remove those program files and shortcuts;
; the chats, settings and credentials next to them stay and are picked up by this version.
Type: filesandordirs; Name: "{localappdata}\BasedCode\app"
Type: filesandordirs; Name: "{localappdata}\BasedCode\nwjs"
Type: files; Name: "{localappdata}\BasedCode\node.exe"
Type: files; Name: "{localappdata}\BasedCode\BasedCode.exe"
Type: files; Name: "{localappdata}\BasedCode\BasedCode.ico"
Type: files; Name: "{localappdata}\BasedCode\unins*.exe"
Type: files; Name: "{localappdata}\BasedCode\unins*.dat"
Type: files; Name: "{userprograms}\BasedCode.lnk"
Type: files; Name: "{userdesktop}\BasedCode.lnk"

[Registry]
; Drop the old per-user entry from "Installed apps" so only this install is listed.
Root: HKCU; Subkey: "{#LegacyUninstallKey}"; Flags: deletekey dontcreatekey

[Files]
Source: "{#SourceDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\BasedCode"; Filename: "{app}\BasedCode.exe"
Name: "{autodesktop}\BasedCode"; Filename: "{app}\BasedCode.exe"; Tasks: desktopicon

[Run]
Filename: "{app}\BasedCode.exe"; Description: "{cm:LaunchProgram,BasedCode}"; Flags: nowait postinstall skipifsilent
; The in-app updater installs silently with /RELAUNCH=1, then reopens the app as the signed-in user (not elevated).
Filename: "{app}\BasedCode.exe"; Flags: nowait runasoriginaluser; Check: ShouldRelaunch

[UninstallDelete]
; The install folder holds program files only; user data in %LOCALAPPDATA%\BasedCode is kept.
Type: filesandordirs; Name: "{app}"

[Code]
function ShouldRelaunch: Boolean;
begin
  Result := ExpandConstant('{param:RELAUNCH|0}') = '1';
end;

{ Waits up to Attempts half-seconds for processes started from Folder to exit, then stops what is left,
  so node.exe and nw.exe are not locked while their files are replaced or removed. }
procedure StopRunningApp(const Folder: String; Attempts: Integer);
var
  ResultCode: Integer;
  Command: String;
begin
  Command := '-NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "' +
    '$find = { Get-Process | Where-Object { $_.Path -like ''' + Folder + '\*'' } }; ' +
    'for ($i = 0; $i -lt ' + IntToStr(Attempts) + ' -and (& $find); $i++) { Start-Sleep -Milliseconds 500 }; ' +
    '& $find | Stop-Process -Force"';
  Exec(ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe'), Command, '', SW_HIDE,
    ewWaitUntilTerminated, ResultCode);
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
begin
  Result := '';
  { During an in-app update the app is shutting itself down: give it ten seconds to finish cleanly. }
  if ShouldRelaunch then
    StopRunningApp(ExpandConstant('{app}'), 20)
  else
    StopRunningApp(ExpandConstant('{app}'), 0);
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
begin
  if CurUninstallStep = usUninstall then
    StopRunningApp(ExpandConstant('{app}'), 0);
end;
