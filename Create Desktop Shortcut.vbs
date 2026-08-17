' Run this once (double-click it) after downloading this project.
' Creates a "Background Remover" shortcut on your Desktop, with the
' Cirno icon, that starts the app when double-clicked.
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
desktopPath = shell.SpecialFolders("Desktop")

Set shortcut = shell.CreateShortcut(desktopPath & "\Background Remover.lnk")
shortcut.TargetPath = scriptDir & "\Launch BG Remover.vbs"
shortcut.WorkingDirectory = scriptDir
shortcut.IconLocation = scriptDir & "\icons\app.ico"
shortcut.Description = "Background Remover & Touch-Up"
shortcut.Save

MsgBox "Done! Look for ""Background Remover"" on your Desktop.", vbInformation, "Shortcut created"
