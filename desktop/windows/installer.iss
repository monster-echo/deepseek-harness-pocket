; DSH Pocket Worker Windows 安装器（Inno Setup）
; 从 desktop/ 目录运行（相对 OutputDir 按 iscc 进程 CWD 解析）：
; CI: iscc /DAppVersion=<版本> /DSourceDir=<绝对 Release 目录> windows/installer.iss

#ifndef AppVersion
#define AppVersion "0.1.0"
#endif

#ifndef SourceDir
#define SourceDir "..\build\windows\x64\runner\Release"
#endif

[Setup]
AppId={{ae8d7396-4274-437d-83e3-4af167c1cfc1}
AppName=DSH Pocket Worker
AppVersion={#AppVersion}
AppPublisher=掌鲸 DSH Pocket
DefaultDirName={autopf}\DSH Pocket Worker
DefaultGroupName=DSH Pocket Worker
UninstallDisplayName=DSH Pocket Worker
OutputBaseFilename=DSH-Pocket-Worker-Setup-{#AppVersion}
OutputDir=..
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
ArchitecturesInstallIn64BitMode=x64compatible
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog

[Files]
Source: "{#SourceDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs

[Icons]
Name: "{group}\DSH Pocket Worker"; Filename: "{app}\dsh-pocket-worker.exe"
Name: "{autodesktop}\DSH Pocket Worker"; Filename: "{app}\dsh-pocket-worker.exe"; Tasks: desktopicon

[Tasks]
Name: "desktopicon"; Description: "创建桌面快捷方式"; GroupDescription: "附加快捷方式:"
