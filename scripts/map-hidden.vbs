' Starts One-Way-Out with no console window. Output goes to %LOCALAPPDATA%\one-way-out.log.
' If the map is already running, server.mjs sees the port is taken and just opens the browser tab.
Set sh = CreateObject("WScript.Shell")
logFile = sh.ExpandEnvironmentStrings("%LOCALAPPDATA%") & "\one-way-out.log"
root = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName) & "\.."
sh.Run "cmd /c node """ & root & "\server.mjs"" >> """ & logFile & """ 2>&1", 0, False
