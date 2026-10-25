# Native dialog/size support for ui-windows-native.mjs. Only a disposable QA EXE is accepted.
param([Parameter(Mandatory=$true)][string]$RequestPath)
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
[Console]::OutputEncoding=[Text.Encoding]::UTF8
$request=Get-Content $RequestPath -Raw -Encoding UTF8|ConvertFrom-Json
$appPath=[IO.Path]::GetFullPath($request.appPath)
if($appPath -notmatch '\\Temp\\lexicue-v31-windows-[^\\]+\\repo\\src-tauri\\target\\debug\\lexicue-qa.exe$'){throw 'Refusing non-QA application path'}
$config=Get-Content ([IO.Path]::GetFullPath((Join-Path ([IO.Path]::GetDirectoryName($appPath)) '..\..\tauri.conf.json'))) -Raw|ConvertFrom-Json
if($config.identifier -notmatch '^com\.lexicue\.qa\.v31\.windows'){throw 'Refusing non-QA identifier'}
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type @'
using System;
using System.Runtime.InteropServices;
public class LexiCueNativeWindow {
 [StructLayout(LayoutKind.Sequential)] public struct RECT {public int Left,Top,Right,Bottom;}
 [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h,out RECT r);
 [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr h,out RECT r);
 [DllImport("user32.dll")] public static extern uint GetDpiForWindow(IntPtr h);
 [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
 [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr h,System.Text.StringBuilder value,int count);
 [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr SendMessage(IntPtr h,uint msg,IntPtr w,string value);
 [DllImport("user32.dll", EntryPoint="SendMessageW")] public static extern IntPtr SendControlMessage(IntPtr h,uint msg,IntPtr w,IntPtr value);
 [DllImport("user32.dll")] public static extern int GetDlgCtrlID(IntPtr h);
 [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h,out uint pid);
 [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h,uint msg,IntPtr w,IntPtr value);
 [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h,IntPtr after,int x,int y,int w,int hgt,uint flags);
}
'@
[void][LexiCueNativeWindow]::SetThreadDpiAwarenessContext([IntPtr](-4))
function QaProcesses { @(Get-CimInstance Win32_Process -Filter "Name='lexicue-qa.exe'"|Where-Object {$_.ExecutablePath -eq $appPath}|ForEach-Object {Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue}) }
function NativeClass($element){
 if(!$element.Current.NativeWindowHandle){return ''}
 $value=New-Object Text.StringBuilder 256
 [void][LexiCueNativeWindow]::GetClassName([IntPtr]$element.Current.NativeWindowHandle,$value,256)
 return $value.ToString()
}
function OwnedHandle($element){
 $handle=[IntPtr]$element.Current.NativeWindowHandle
 if($handle -eq [IntPtr]::Zero){throw 'Native QA control handle missing'}
 [uint32]$owner=0
 [void][LexiCueNativeWindow]::GetWindowThreadProcessId($handle,[ref]$owner)
 if($owner -ne $dialog.Current.ProcessId){throw 'Refusing control outside QA dialog process'}
 return $handle
}
$deadline=[DateTime]::UtcNow.AddSeconds(40)
if($request.action -in @('resize','close')){
 $processes=QaProcesses
 $process=$processes|Where-Object {$_.MainWindowHandle -ne 0}|Select-Object -First 1
 if(!$process){throw 'QA window missing'}
 $handle=$process.MainWindowHandle
 if($request.action -eq 'close'){
  if(![LexiCueNativeWindow]::PostMessage($handle,16,[IntPtr]::Zero,[IntPtr]::Zero)){throw 'Normal QA close failed'}
  $until=[DateTime]::UtcNow.AddSeconds(15)
  while((Get-Process -Id $process.Id -ErrorAction SilentlyContinue) -and [DateTime]::UtcNow -lt $until){Start-Sleep -Milliseconds 100}
  if(Get-Process -Id $process.Id -ErrorAction SilentlyContinue){throw 'QA app did not close normally'}
  @{action='close';pid=$process.Id;method='WM_CLOSE'}|ConvertTo-Json -Compress
  exit
 }
 $client=New-Object LexiCueNativeWindow+RECT
 $frame=New-Object LexiCueNativeWindow+RECT
 [void][LexiCueNativeWindow]::GetClientRect($handle,[ref]$client)
 [void][LexiCueNativeWindow]::GetWindowRect($handle,[ref]$frame)
 $scale=[LexiCueNativeWindow]::GetDpiForWindow($handle)/96.0
 $width=[int]([Math]::Round($request.width*$scale)+$frame.Right-$frame.Left-$client.Right)
 $height=[int]([Math]::Round($request.height*$scale)+$frame.Bottom-$frame.Top-$client.Bottom)
 if(![LexiCueNativeWindow]::SetWindowPos($handle,[IntPtr]::Zero,0,0,$width,$height,6)){throw 'Resize failed'}
 @{action='resize';pid=$process.Id;scale=$scale;width=$request.width;height=$request.height}|ConvertTo-Json -Compress
 exit
}
if($request.action -notin @('file','button','inspect')){throw 'Unknown QA action'}
$dialog=$null
while(!$dialog -and [DateTime]::UtcNow -lt $deadline){
 $processes=QaProcesses
 foreach($process in $processes){
  $condition=New-Object Windows.Automation.AndCondition @((New-Object Windows.Automation.PropertyCondition([Windows.Automation.AutomationElement]::ProcessIdProperty,$process.Id)),(New-Object Windows.Automation.PropertyCondition([Windows.Automation.AutomationElement]::ClassNameProperty,'#32770')))
  $ownerCondition=New-Object Windows.Automation.PropertyCondition([Windows.Automation.AutomationElement]::ProcessIdProperty,$process.Id)
  $roots=[Windows.Automation.AutomationElement]::RootElement.FindAll([Windows.Automation.TreeScope]::Children,$ownerCondition)
  foreach($root in $roots){
   if($root.Current.ClassName -eq '#32770'){$dialog=$root}
   else{$dialog=$root.FindFirst([Windows.Automation.TreeScope]::Descendants,$condition)}
   if($dialog){break}
  }
  if($dialog){break}
 }
 if(!$dialog){Start-Sleep -Milliseconds 100}
}
if(!$dialog){throw 'QA native dialog missing'}
$nodes=$dialog.FindAll([Windows.Automation.TreeScope]::Descendants,[Windows.Automation.Condition]::TrueCondition)
if($request.action -eq 'file'){
 $controlsReady=[DateTime]::UtcNow.AddSeconds(15)
 while(!(@($nodes|Where-Object {(NativeClass $_) -eq 'Edit'}).Count) -and [DateTime]::UtcNow -lt $controlsReady){Start-Sleep -Milliseconds 100;$nodes=$dialog.FindAll([Windows.Automation.TreeScope]::Descendants,[Windows.Automation.Condition]::TrueCondition)}
}
$tree=@($nodes|ForEach-Object {@{name=$_.Current.Name;id=$_.Current.AutomationId;type=$_.Current.ControlType.ProgrammaticName;nativeClass=(NativeClass $_);enabled=$_.Current.IsEnabled}})
if($request.evidence){@{window=$dialog.Current.Name;pid=$dialog.Current.ProcessId;action=$request.action;controls=@($tree|Where-Object {$_.nativeClass -in @('Edit','ComboBox','ComboBoxEx32','Button')})}|ConvertTo-Json -Depth 8|Set-Content -Encoding UTF8 $request.evidence}
if($request.action -eq 'inspect'){$tree|ConvertTo-Json -Compress;exit}
if($request.action -eq 'file'){
 $edit=@($nodes|Where-Object {(NativeClass $_) -eq 'Edit' -and $_.Current.AutomationId -in @('1001','1148')})|Select-Object -First 1
 if(!$edit){throw 'Native file-name field missing'}
 $value=(@($request.paths)|ForEach-Object {'"'+$_+'"'}) -join ' '
 $valuePattern=$null
 if($edit.TryGetCurrentPattern([Windows.Automation.ValuePattern]::Pattern,[ref]$valuePattern)){$valuePattern.SetValue($value)}
 else{[void][LexiCueNativeWindow]::SendMessage((OwnedHandle $edit),12,[IntPtr]::Zero,$value)}
 $button=@($nodes|Where-Object {((NativeClass $_) -eq 'Button' -or $_.Current.ControlType -eq [Windows.Automation.ControlType]::Button) -and $_.Current.AutomationId -eq '1'})|Select-Object -First 1
}else{
 $button=@($nodes|Where-Object {((NativeClass $_) -eq 'Button' -or $_.Current.ControlType -eq [Windows.Automation.ControlType]::Button) -and $_.Current.Name -match $request.name})|Select-Object -First 1
}
if(!$button){throw 'QA dialog action button missing'}
$result=@{action=$request.action;window=$dialog.Current.Name;pid=$dialog.Current.ProcessId;button=$button.Current.Name}
$invoke=$null
if($button.TryGetCurrentPattern([Windows.Automation.InvokePattern]::Pattern,[ref]$invoke)){$invoke.Invoke()}
else{[void][LexiCueNativeWindow]::SendControlMessage((OwnedHandle $button),245,[IntPtr]::Zero,[IntPtr]::Zero)}
$result|ConvertTo-Json -Compress
