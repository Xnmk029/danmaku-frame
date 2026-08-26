Add-Type @"
using System;
using System.Runtime.InteropServices;
public class L2DPanel {
    [DllImport("user32.dll")] public static extern IntPtr FindWindow(string className, string windowTitle);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
}
"@
$h = [L2DPanel]::FindWindow($null, "Live2D Lite - 控制面板")
if ($h -ne [IntPtr]::Zero) {
    [L2DPanel]::ShowWindow($h, 9) | Out-Null
    [L2DPanel]::SetForegroundWindow($h) | Out-Null
    Write-Output "OK"
} else {
    Write-Output "NOT_FOUND"
}
