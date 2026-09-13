Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
currentDir = fso.GetParentFolderName(WScript.ScriptFullName)
serverDir = fso.BuildPath(currentDir, "server")
WshShell.CurrentDirectory = serverDir
WshShell.Run "cmd.exe /c node server.js", 0, False
Set WshShell = Nothing
