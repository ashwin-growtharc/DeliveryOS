; DeliveryOS CLI PATH setup -- Tauri NSIS installer hook.
;
; Referenced via `bundle.windows.nsis.installerHooks` in tauri.conf.json.
; Tauri's own generated installer.nsi `!include`s this file, then invokes
; whichever of the four NSIS_HOOK_* macros it defines at the matching
; point in the real install/uninstall flow (see @tauri-apps/cli's own
; config schema for the exact 4 hook names/timing).
;
; Goal: after install, `deliveryos.exe` (a self-contained CLI exe, shipped
; as a plain `bundle.resources` entry -- see tauri.conf.json -- not a
; Tauri externalBin/sidecar) is reachable on the CURRENT USER's PATH from
; a brand-new terminal, with no separate `npm link`/Node install required.
; After uninstall, that PATH entry is removed again, and nothing else the
; user has on PATH is touched.
;
; **Build status**: this file now compiles through a real `makensis` run --
; `npx tauri build` produces the NSIS installer successfully. That first real
; build immediately found a genuine error hand-tracing had missed (${StrRep}
; used in the uninstall section, where NSIS only permits "un."-prefixed
; calls), which is why the caveat that used to sit here mattered.
;
; Still NOT verified by a real build: the runtime BEHAVIOUR -- that the PATH
; entry is actually added on install and cleanly removed on uninstall. That
; needs a real install/uninstall cycle on a real machine; see
; docs/manual-smoke-test-cli-install.md.
;
; Uses only instructions/headers that ship with stock NSIS itself, never
; a third-party plugin (no EnVar, nothing downloaded separately):
;   - WinMessages.nsh -- ships with NSIS, defines HWND_BROADCAST/WM_WININICHANGE.
;   - StrFunc.nsh -- ships with NSIS (Include\StrFunc.nsh), defines the
;     ${StrStr}/${StrRep} macros used below for substring search/replace,
;     since raw NSIS has no built-in "does this string contain that
;     substring" instruction.

!include "WinMessages.nsh"
!include "StrFunc.nsh"

; StrFunc.nsh's own convention: invoking a macro with no arguments, once,
; at file scope (outside any Section/Function/other macro) generates the
; real Function block these calls below rely on. Must happen exactly once
; per script -- placed here, at the top of this included file, rather
; than inside either NSIS_HOOK_* macro below.
;
; The Un- prefixed variants are SEPARATE generated functions, and they are
; not optional: NSIS keeps install and uninstall functions in different
; namespaces, and a `Call` from an uninstall section must name a function
; starting with "un.". Using ${StrRep} inside NSIS_HOOK_POSTUNINSTALL is
; therefore a hard makensis error, not a style issue:
;
;   Call must be used with function names starting with "un." in the
;   uninstall section.
;   Error in macro STRFUNC_CALL_StrRep on macroline 7
;   Error in macro NSIS_HOOK_POSTUNINSTALL on macroline 15
;
; That is exactly what the very first real `tauri build` of this file
; produced -- the verification this script's header said it still needed.
; The MSI bundled fine and the NSIS installer, the one we actually ship,
; failed outright.
${StrStr}
${StrRep}
${UnStrRep}

; Resolves which real on-disk directory the `deliveryos.exe` resource
; landed in, into $R9 -- checked defensively rather than assumed, since
; the exact `bundle.resources` output layout can't be confirmed without a
; real build (see the plan this was written from). Sets $R9 to "" if
; neither known location exists, which every caller below must check for
; and skip cleanly, not crash on.
!macro DeliveryOsResolveCliDir
  StrCpy $R9 ""
  IfFileExists "$INSTDIR\deliveryos.exe" 0 +2
    StrCpy $R9 "$INSTDIR"
  StrCmp $R9 "" 0 +3
    IfFileExists "$INSTDIR\resources\deliveryos.exe" 0 +2
      StrCpy $R9 "$INSTDIR\resources"
!macroend

; NSIS string ops (ReadRegStr/WriteRegExpandStr included) are bounded by a
; compile-time length limit this script cannot introspect from outside a
; real makensis build. 900 is a deliberately conservative threshold well
; under even the most conservative commonly-cited limit (1024) -- if the
; user's existing PATH is already this long, skip writing rather than
; risk silently truncating it, and say so via a real (if blunt) message
; box instead of failing silently.
!macro DeliveryOsPathTooLongGuard Var
  StrLen $R8 "${Var}"
  IntCmp $R8 900 +3 +3 0
    MessageBox MB_OK "DeliveryOS: your PATH is already very long, so the installer did not add deliveryos.exe to it automatically -- add $R9 to your PATH by hand if you want to use the deliveryos CLI."
    Abort
!macroend

!macro NSIS_HOOK_POSTINSTALL
  !insertmacro DeliveryOsResolveCliDir
  StrCmp $R9 "" postinstall_done 0

  ClearErrors
  ReadRegStr $R0 HKCU "Environment" "Path"
  IfErrors 0 +2
    StrCpy $R0 ""

  ; Semicolon-wrap both sides before searching, so a directory that
  ; merely PREFIXES another (e.g. "C:\DeliveryOS" vs. "C:\DeliveryOS2")
  ; can never false-match, and so the check is agnostic to whether the
  ; real entry sits at the very start/end of PATH (which would otherwise
  ; lack one of the two surrounding semicolons a naive check might expect).
  StrCpy $R1 ";$R0;"
  StrCpy $R2 ";$R9;"
  ${StrStr} $R3 "$R1" "$R2"
  StrCmp $R3 "" 0 postinstall_done ; non-empty result -- already present, nothing to do

  !insertmacro DeliveryOsPathTooLongGuard $R0

  StrCmp $R0 "" 0 +3
    StrCpy $R4 "$R9"
    Goto +2
    StrCpy $R4 "$R0;$R9"
  WriteRegExpandStr HKCU "Environment" "Path" "$R4"
  SendMessage ${HWND_BROADCAST} ${WM_WININICHANGE} 0 "STR:Environment" /TIMEOUT=5000

  postinstall_done:
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  !insertmacro DeliveryOsResolveCliDir
  StrCmp $R9 "" postuninstall_done 0

  ClearErrors
  ReadRegStr $R0 HKCU "Environment" "Path"
  IfErrors postuninstall_done 0

  ; Pad with a leading/trailing semicolon, replace the padded target
  ; (also semicolon-wrapped) with a single semicolon -- this correctly
  ; collapses whichever of "middle", "start", or "end" position the real
  ; entry was in down to one separator, never leaving a stray double
  ; semicolon or eating a neighboring entry.
  StrCpy $R1 ";$R0;"
  StrCpy $R2 ";$R9;"
  ; ${UnStrRep}, not ${StrRep} -- see the declaration block at the top of this
  ; file. This macro runs in the UNINSTALL section, where only "un."-prefixed
  ; functions may be called.
  ${UnStrRep} $R3 "$R1" "$R2" ";"

  ; Strip the leading/trailing semicolon this padding added back off,
  ; rather than writing the padded form back to the registry. Handled as
  ; an explicit zero-or-negative case, not folded into the StrCpy call
  ; below: if $R9 was PATH's ONLY entry, $R3 collapses to just ";" and
  ; the naive length-minus-2 goes negative -- NSIS's StrCpy treats a
  ; negative length as "trim N chars off the far end," a completely
  ; different (and here, wrong) operation, not "copy zero chars."
  StrLen $R4 "$R3"
  IntOp $R4 $R4 - 2
  IntCmp $R4 1 deliveryos_uninstall_nonempty deliveryos_uninstall_empty deliveryos_uninstall_nonempty
  deliveryos_uninstall_empty:
    StrCpy $R5 ""
    Goto deliveryos_uninstall_write
  deliveryos_uninstall_nonempty:
    StrCpy $R5 "$R3" $R4 1
  deliveryos_uninstall_write:

  WriteRegExpandStr HKCU "Environment" "Path" "$R5"
  SendMessage ${HWND_BROADCAST} ${WM_WININICHANGE} 0 "STR:Environment" /TIMEOUT=5000

  postuninstall_done:
!macroend
