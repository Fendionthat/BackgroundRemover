' Starts the local server (if not already running) and opens the app
' in its own window (no browser tabs/address bar).
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)

On Error Resume Next
shell.Run "pythonw -m http.server 8000 --directory """ & scriptDir & """", 0, False
On Error Goto 0

WScript.Sleep 700

chromePath = "C:\Program Files\Google\Chrome\Application\chrome.exe"
chromePathX86 = "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
edgePath = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
edgePath2 = "C:\Program Files\Microsoft\Edge\Application\msedge.exe"

appArgs = " --app=http://localhost:8000 --window-size=1200,860"

If fso.FileExists(chromePath) Then
  shell.Run """" & chromePath & """" & appArgs, 1, False
ElseIf fso.FileExists(chromePathX86) Then
  shell.Run """" & chromePathX86 & """" & appArgs, 1, False
ElseIf fso.FileExists(edgePath) Then
  shell.Run """" & edgePath & """" & appArgs, 1, False
ElseIf fso.FileExists(edgePath2) Then
  shell.Run """" & edgePath2 & """" & appArgs, 1, False
Else
  shell.Run "http://localhost:8000"
End If
