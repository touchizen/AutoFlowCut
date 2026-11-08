param([string]$Action,[int]$TargetPid,[string]$Target,[string]$Bounds)
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=New-Object System.Text.UTF8Encoding($false)
Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes,WindowsBase
Add-Type -TypeDefinition 'using System.Runtime.InteropServices; public class FlowDpi { [DllImport("user32.dll")] public static extern bool SetProcessDPIAware(); [DllImport("user32.dll")] public static extern System.IntPtr GetLastActivePopup(System.IntPtr handle); [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(System.IntPtr h, out uint pid); }'
[void][FlowDpi]::SetProcessDPIAware()
$proc=Get-Process -Id $TargetPid
if (!$proc.MainWindowHandle) { exit 3 }
$win=[Windows.Automation.AutomationElement]::FromHandle($proc.MainWindowHandle)
$scope=[Windows.Automation.TreeScope]
$walker=[Windows.Automation.TreeWalker]::RawViewWalker
function Pattern($e,$p) { $v=$null; if($e.TryGetCurrentPattern($p,[ref]$v)){ return $v }; return $null }
function ByType($e,$type) {
 $cond=New-Object Windows.Automation.PropertyCondition([Windows.Automation.AutomationElement]::ControlTypeProperty,$type)
 return $e.FindAll($scope::Descendants,$cond)
}
if($Action -eq 'open'){
 $handle=[FlowDpi]::GetLastActivePopup($proc.MainWindowHandle)
 [uint32]$owner=0; [void][FlowDpi]::GetWindowThreadProcessId($handle,[ref]$owner)
 if($owner -ne $TargetPid -or $handle -eq $proc.MainWindowHandle){exit 5}
 $dialog=[Windows.Automation.AutomationElement]::FromHandle($handle)
 if($dialog.Current.ClassName -ne '#32770'){exit 5}
 $dialogs=@($dialog)
 $fields=@(ByType $dialog ([Windows.Automation.ControlType]::Edit) | Where-Object {
  $el=$_; $inside=$false
  for($i=0;$i -lt 8 -and $el;$i++){
   if($el.Current.AutomationId -in '1148','FileNameControlHost'){ $inside=$true;break }
   $el=$walker.GetParent($el)
  }; $inside
 })
 $buttons=@(ByType $dialogs[0] ([Windows.Automation.ControlType]::Button) | Where-Object {$_.Current.AutomationId -eq '1'})
 if($fields.Count -ne 1 -or $buttons.Count -ne 1){exit 5}
 $value=Pattern $fields[0] ([Windows.Automation.ValuePattern]::Pattern)
 $value.SetValue($Target)
 if($value.Current.Value -cne $Target){exit 6}
 (Pattern $buttons[0] ([Windows.Automation.InvokePattern]::Pattern)).Invoke(); exit 0
}
if($Action -ne 'snapshot'){exit 1}
$docs=@(ByType $win ([Windows.Automation.ControlType]::Document) | Where-Object {
 $p=Pattern $_ ([Windows.Automation.ValuePattern]::Pattern)
 if($p -and $p.Current.Value -match '^https?://'){ $p.Current.Value.TrimEnd('/') -ceq $Target }
 elseif($Bounds){ # Electron verified the URL. Bind the native document by the exact physical rectangle of that WebContentsView.
   $a=$Bounds.Split(','); $r=$_.Current.BoundingRectangle
   !$r.IsEmpty -and !($_.Current.IsOffscreen) -and [Math]::Abs($r.X-[double]$a[0]) -le 2 -and [Math]::Abs($r.Y-[double]$a[1]) -le 2 -and [Math]::Abs($r.Width-[double]$a[2]) -le 2 -and [Math]::Abs($r.Height-[double]$a[3]) -le 2
 }else{$false}
})
if($docs.Count -ne 1){exit 3}
$count=0
function Node($e,$depth) {
 if(++$script:count -gt 16000 -or $depth -gt 80){throw 'tree-limit'}
 $state=$e.Current; $role=$state.ControlType.ProgrammaticName.Split('.')[-1]
 $mapped=@{Document='WebArea';Text='StaticText';Edit='TextArea';ComboBox='PopUpButton';TabItem='Tab';List='ListBox'}[$role]; if($mapped){$role=$mapped}
 $sel=Pattern $e ([Windows.Automation.SelectionItemPattern]::Pattern)
 $toggle=Pattern $e ([Windows.Automation.TogglePattern]::Pattern)
 $val=Pattern $e ([Windows.Automation.ValuePattern]::Pattern)
 $rect=$state.BoundingRectangle; $box=@(0,0,0,0)
 if(!$rect.IsEmpty){$box=@($rect.X,$rect.Y,$rect.Width,$rect.Height)}
 $children=New-Object 'System.Collections.Generic.List[object]'
 $child=$walker.GetFirstChild($e)
 while($child){$children.Add((Node $child ($depth+1)));$child=$walker.GetNextSibling($child)}
 return @{role=$role;name=$state.Name;description=$state.HelpText;value=$(if($val){$val.Current.Value}else{''});enabled=($state.IsEnabled -and !$state.IsOffscreen);focused=$state.HasKeyboardFocus;toggleState=$(if($toggle -and $toggle.Current.ToggleState -ne 'Indeterminate'){$toggle.Current.ToggleState -eq 'On'}else{$null});selected=$(if($sel){$sel.Current.IsSelected}elseif($toggle -and $toggle.Current.ToggleState -ne 'Indeterminate'){$toggle.Current.ToggleState -eq 'On'}else{$null});rect=$box;children=$children}
}
Node $docs[0] 0 | ConvertTo-Json -Depth 100 -Compress
