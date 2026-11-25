; Перед копированием файлов закрываем уже запущенный Amadeus и его ядро.
; Иначе NSIS не может перезаписать amadeus-core.exe, и установка падает.
!macro NSIS_HOOK_PREINSTALL
  nsExec::ExecToStack 'taskkill /IM amadeus.exe /F /T'
  Pop $0
  Pop $1
  nsExec::ExecToStack 'taskkill /IM amadeus-core.exe /F /T'
  Pop $0
  Pop $1
  Sleep 700
!macroend

; То же самое при удалении: файлы ядра тоже могут быть заняты.
!macro NSIS_HOOK_PREUNINSTALL
  nsExec::ExecToStack 'taskkill /IM amadeus.exe /F /T'
  Pop $0
  Pop $1
  nsExec::ExecToStack 'taskkill /IM amadeus-core.exe /F /T'
  Pop $0
  Pop $1
  Sleep 700
!macroend
