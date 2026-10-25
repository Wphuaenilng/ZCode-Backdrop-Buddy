#define MyAppName "BackdropBuddy"
#ifndef MyAppVersion
  #define MyAppVersion "1.0.0"
#endif
#ifndef SourceDir
  #define SourceDir "..\out\BackdropBuddy-1.0.0"
#endif
#define MyAppPublisher "Juntian Works"
#define MyAppExeName "BackdropBuddy.exe"
#define WebView2ClientGuid "{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}"
#define WebView2DownloadPage "https://go.microsoft.com/fwlink/p/?LinkId=2124703"

[Setup]
AppId={{7E1F0F5C-3B7A-4D93-9B5E-2A4C8D6F1E20}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppVerName={#MyAppName} {#MyAppVersion}
AppPublisher={#MyAppPublisher}
VersionInfoVersion={#MyAppVersion}.0
VersionInfoProductVersion={#MyAppVersion}.0
VersionInfoCompany={#MyAppPublisher}
VersionInfoDescription={#MyAppName} Setup
DefaultDirName={localappdata}\Programs\BackdropBuddy
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
AllowNoIcons=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0
OutputDir=out
OutputBaseFilename=BackdropBuddy-Setup-{#MyAppVersion}
SetupIconFile=BackdropBuddy.ico
UninstallDisplayIcon={app}\{#MyAppExeName}
UninstallDisplayName={#MyAppName} {#MyAppVersion}
LicenseFile=..\docs\LICENSE
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
CloseApplications=yes
RestartApplications=no
LanguageDetectionMethod=uilanguage
ShowLanguageDialog=auto
SetupLogging=yes

[Languages]
Name: "chinesesimplified"; MessagesFile: "ChineseSimplified.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[Files]
Source: "{#SourceDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; WorkingDir: "{app}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; WorkingDir: "{app}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "{cm:LaunchProgram,{#StringChange(MyAppName, '&', '&&')}}"; Flags: nowait postinstall skipifsilent

[UninstallDelete]
Type: filesandordirs; Name: "{app}"

[Code]
function WebView2VersionAt(RootKey: Integer; const SubKey: String): String;
var
  Value: String;
begin
  Result := '';
  if RegQueryStringValue(RootKey, SubKey, 'pv', Value) then
    Result := Trim(Value);
end;

function DetectWebView2(): String;
begin
  Result := WebView2VersionAt(HKCU, 'Software\Microsoft\EdgeUpdate\Clients\' + '{#WebView2ClientGuid}');
  if Result = '' then
    Result := WebView2VersionAt(HKLM, 'SOFTWARE\Microsoft\EdgeUpdate\Clients\' + '{#WebView2ClientGuid}');
  if Result = '' then
    Result := WebView2VersionAt(HKLM64, 'SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\' + '{#WebView2ClientGuid}');
end;

function HasDotNet48(): Boolean;
var
  Release: Cardinal;
begin
  Result := RegQueryDWordValue(HKLM64, 'SOFTWARE\Microsoft\NET Framework Setup\NDP\v4\Full', 'Release', Release)
    and (Release >= 528040);
end;

function InitializeSetup(): Boolean;
var
  RuntimeVersion: String;
  ErrorCode: Integer;
begin
  Result := True;

  RuntimeVersion := DetectWebView2();
  if RuntimeVersion = '' then
  begin
    Log('WebView2 Runtime not detected');
    if not WizardSilent then
    begin
      if MsgBox('未检测到 Microsoft Edge WebView2 Runtime。' + #13#10 + #13#10 +
        'BackdropBuddy 依赖 WebView2 显示界面。' + #13#10 + #13#10 +
        '仍要继续安装吗？选择“否”将打开 Microsoft 下载页面并退出安装。',
        mbConfirmation, MB_YESNO) = IDNO then
      begin
        ShellExec('open', '{#WebView2DownloadPage}', '', '', SW_SHOWNORMAL, ewNoWait, ErrorCode);
        Result := False;
      end;
    end;
  end
  else
    Log('WebView2 Runtime detected: ' + RuntimeVersion);

  if Result and (not HasDotNet48()) then
  begin
    Log('Microsoft .NET Framework 4.8 not detected');
    if not WizardSilent then
    begin
      if MsgBox('未检测到 Microsoft .NET Framework 4.8。' + #13#10 + #13#10 +
        'BackdropBuddy 需要 .NET Framework 4.8 才能启动。' + #13#10 + #13#10 +
        '仍要继续安装吗？',
        mbConfirmation, MB_YESNO) = IDNO then
        Result := False;
    end;
  end
  else if Result then
    Log('Microsoft .NET Framework 4.8 detected');
end;

function IsBackdropBuddyDataDir(const Dir: String): Boolean;
var
  Trimmed: String;
  Profile: String;
begin
  Result := False;
  if Dir = '' then Exit;
  if not DirExists(Dir) then Exit;

  Trimmed := RemoveBackslashUnlessRoot(Dir);
  if Length(Trimmed) <= 2 then Exit;
  if CompareText(Trimmed, RemoveBackslashUnlessRoot(ExpandConstant('{localappdata}'))) = 0 then Exit;
  // {userprofile} is not resolvable in the uninstaller on this Inno build (unknown constant),
  // so read the environment variable directly and skip the check when it is not set.
  Profile := GetEnv('USERPROFILE');
  if (Profile <> '') and (CompareText(Trimmed, RemoveBackslashUnlessRoot(Profile)) = 0) then Exit;
  if CompareText(Trimmed, RemoveBackslashUnlessRoot(ExpandConstant('{userdocs}'))) = 0 then Exit;
  if CompareText(Trimmed, RemoveBackslashUnlessRoot(ExpandConstant('{win}'))) = 0 then Exit;

  if not DirExists(AddBackslash(Trimmed) + 'themes') then Exit;

  Result := FileExists(AddBackslash(Trimmed) + 'config.json')
    or FileExists(AddBackslash(Trimmed) + 'themes\pointer.json')
    or FileExists(AddBackslash(Trimmed) + 'themes\runtime.json')
    or DirExists(AddBackslash(Trimmed) + 'themes\user');
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  DataDir: String;
  Purge: String;
begin
  if CurUninstallStep <> usPostUninstall then
    Exit;

  DataDir := GetEnv('BACKDROPBUDDY_DATA_DIR');
  if DataDir = '' then
    DataDir := ExpandConstant('{localappdata}\BackdropBuddy');
  if not DirExists(DataDir) then
    Exit;

  if not IsBackdropBuddyDataDir(DataDir) then
  begin
    Log('BackdropBuddy data preserved: directory shape not recognized: ' + DataDir);
    if not UninstallSilent then
      MsgBox('BACKDROPBUDDY_DATA_DIR 指向的目录不像 BackdropBuddy 数据目录，已保留：' + #13#10 + #13#10 + DataDir,
        mbInformation, MB_OK);
    Exit;
  end;

  Purge := ExpandConstant('{param:PURGEDATA|0}');
  if Purge = '1' then
  begin
    DelTree(DataDir, True, True, True);
    Log('BackdropBuddy data removed (PURGEDATA=1): ' + DataDir);
    Exit;
  end;

  if UninstallSilent then
  begin
    Log('BackdropBuddy data preserved (silent uninstall): ' + DataDir);
    Exit;
  end;

  if MsgBox('是否同时删除主题、备份与设置？' + #13#10 + #13#10 +
    '位置：' + DataDir + #13#10 + #13#10 +
    '选择“否”将保留这些数据，以后重新安装时仍可使用。',
    mbConfirmation, MB_YESNO) = IDYES then
  begin
    DelTree(DataDir, True, True, True);
    Log('BackdropBuddy data removed by user choice: ' + DataDir);
  end
  else
    Log('BackdropBuddy data preserved by user choice: ' + DataDir);
end;
