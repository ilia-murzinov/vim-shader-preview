scriptencoding utf-8

let s:is_running = 0
let s:last_watch = ''
let s:vim_job = v:null
let s:nvim_job_id = -1

function! shader_monitor#SxTrim(txt) abort
  return substitute(
        \ a:txt,
        \ '^[[:blank:]\r\n]\+\|[[:blank:]\r\n]\+$',
        \ '',
        \ 'g'
        \ )
endfunction

function! shader_monitor#VxExit(job, _) abort
  let s:is_running = 0
  let s:vim_job = v:null
endfunction

function! shader_monitor#NxExit(job_id, exit_code, event) abort
  let s:is_running = 0
  let s:nvim_job_id = -1
endfunction

function! shader_monitor#noop(...) abort
endfunction

function! shader_monitor#NxStderr(job_id, data, name) abort
  if empty(a:data)
    return
  endif
  let line = substitute(join(a:data, ''), "\\r\\|\\n\\+$", '', 'g')
  if line =~# '^$'
    return
  endif
  echohl WarningMsg
  echom '[shader-monitor] ' . line
  echohl NONE
endfunction

function! shader_monitor#project_root() abort
  " Find checkout root by locating server.mjs (works with rtp symlinks / Stow).
  if exists('g:shader_monitor_project_root')
        \ && g:shader_monitor_project_root !=# ''
    let r = simplify(substitute(
          \ fnamemodify(
          \ expand(g:shader_monitor_project_root),
          \ ':p'),
          \ '\v[/\\]$',
          \ '',
          \ 'g'))

    if filereadable(simplify(r . '/server.mjs'))
      return r
    endif
    echoerr '[shader-monitor] g:shader_monitor_project_root has no server.mjs: ' . r
    return ''
  endif

  let d = simplify(fnamemodify(expand('<sfile>:p'), ':p:h'))
  let start = simplify(d)

  for _ in range(40)
    if filereadable(simplify(d . '/server.mjs'))
      return d
    endif
    let parent = simplify(fnamemodify(d, ':h'))
    if parent ==# d
      break
    endif
    let d = parent
  endfor

  echoerr '[shader-monitor] Cannot find server.mjs from '
        \ . start
        \ . ' — set g:shader_monitor_project_root=/path/to/shader-monitor'
  return ''
endfunction
function! shader_monitor#base_url() abort
  let port_s = '' . g:shader_monitor_port
  return 'http://' . g:shader_monitor_host . ':' . port_s . '/'
endfunction

" Like markdown-preview.nvim mkdp#rpc#stop_server(): ask the Node server to
" close_preview_pages over the wire before jobstop (POST /api/close-pages).
function! s:http_post_close_pages() abort
  let url = substitute(shader_monitor#base_url(), '\v/$', '', '') . '/api/close-pages'
  if !executable('curl')
    return
  endif
  silent call system(
        \ 'curl -sS -m 2 -o /dev/null -X POST ' . shellescape(url) . ' 2>/dev/null')
endfunction

function! shader_monitor#browser_close_preview() abort
  if !get(g:, 'shader_monitor_close_browser_on_stop', 1)
    return
  endif
  call s:http_post_close_pages()
endfunction

function! shader_monitor#status_line() abort
  if s:is_running != 0
    return '[shader-monitor] RUN '
          \ . shader_monitor#base_url()
          \ . ' -> '
          \ . s:last_watch
  endif
  return '[shader-monitor] stopped'
endfunction

function! shader_monitor#running() abort
  return s:is_running
endfunction

" open -n <url> is unreliable on macOS: Launch Services usually hands the URL
" to an already-running browser, which opens a tab. Use a named .app + flags.
function! s:mac_browser_app_bundle(name) abort
  return '/Applications/' . a:name . '.app'
endfunction

function! s:mac_open_chromium_like(app, esc_url) abort
  let bundle = simplify(s:mac_browser_app_bundle(a:app))
  if !isdirectory(bundle)
    return 0
  endif
  silent call system(
        \ 'open -na '
        \ . shellescape(a:app)
        \ . ' --args --new-window '
        \ . a:esc_url)
  return 1
endfunction

function! s:mac_open_firefox(esc_url) abort
  let bundle = simplify(s:mac_browser_app_bundle('Firefox'))
  if !isdirectory(bundle)
    return 0
  endif
  silent call system(
        \ 'open -na Firefox --args -new-window ' . a:esc_url)
  return 1
endfunction

function! s:mac_safari_new_window(abs_url) abort
  if !isdirectory(simplify('/Applications/Safari.app'))
    return 0
  endif
  let u = escape(a:abs_url, '"\\')
  let sc =
        \ 'tell application "Safari" to '
        \ . 'make new document with properties {URL:"' . u . '"}'
  silent call system('osascript -e ' . shellescape(sc))
  return 1
endfunction

function! s:mac_open_new_window(url, esc_url) abort
  let order = get(g:, 'shader_monitor_mac_browser_order', v:null)
  if order is v:null
    let order = [
          \ 'Google Chrome',
          \ 'Arc',
          \ 'Brave Browser',
          \ 'Microsoft Edge',
          \ 'Chromium',
          \ 'Vivaldi',
          \ 'Opera',
          \ ]
  endif
  for app in order
    if s:mac_open_chromium_like(app, a:esc_url)
      return
    endif
  endfor
  if s:mac_open_firefox(a:esc_url)
    return
  endif
  if s:mac_safari_new_window(a:url)
    return
  endif
  silent call system('open ' . a:esc_url)
endfunction

function! shader_monitor#browser_open() abort
  let base = substitute(shader_monitor#base_url(), '\v/$', '', '')
  let url = base . '/'
  if exists('s:browser_open_query') && s:browser_open_query !=# ''
    let url = base . '?' . s:browser_open_query
  endif
  unlet! s:browser_open_query

  if exists('g:shader_monitor_browser_cmd')
        \ && g:shader_monitor_browser_cmd !=# ''
    let cmd = substitute(
          \ g:shader_monitor_browser_cmd,
          \ '%URL%',
          \ shellescape(url),
          \ 'g')
    silent call system(cmd)
    return
  endif

  let esc = shellescape(url)
  let neww = get(g:, 'shader_monitor_open_new_window', 1)

  if has('macunix') || executable('open')
    if !neww
      silent call system('open ' . esc)
      return
    endif
    if has('macunix') || (executable('open') && isdirectory('/Applications'))
      call s:mac_open_new_window(url, esc)
    else
      silent call system('open ' . esc)
    endif
    return
  endif

  if neww
    for exe in [
          \ 'google-chrome',
          \ 'google-chrome-stable',
          \ 'chromium',
          \ 'chromium-browser',
          \ 'brave-browser',
          \ 'firefox',
          \ ]

      if !executable(exe)
        continue
      endif

      if exe ==# 'firefox'
        silent call system(exe . ' -new-window ' . esc)
        return
      endif

      silent call system(exe . ' --new-window ' . esc)
      return
    endfor
  endif

  if executable('xdg-open')
    silent call system('xdg-open ' . esc)
    return
  endif

  if has('win32')
    silent call system('cmd /q /c start "" ' . esc)
    return
  endif

  echohl WarningMsg
  echom '[shader-monitor] Open this URL:'
  echohl NONE
  echom url
endfunction

function! shader_monitor#normalize_watch(expr) abort
  let raw = shader_monitor#SxTrim(a:expr)

  if strlen(raw) > 0
    let target = simplify(fnamemodify(expand(raw), ':p'))
    let ext = tolower(fnamemodify(raw, ':e'))

    let is_shader =
          \ ext ==# 'frag'
          \ || ext ==# 'glsl'
          \ || ext ==# 'vert'

    if is_shader || (filereadable(target) && ext !=# '')
      return simplify(fnamemodify(target, ':p:h'))
    endif

    if isdirectory(target)
      return simplify(target)
    endif

    echohl WarningMsg
    echom '[shader-monitor] Bad path — using shaders/'
    echohl NONE
    let pr = simplify(shader_monitor#project_root())
    let sh = pr . '/shaders'
    silent! call mkdir(sh, 'p')
    return simplify(sh)
  endif

  if exists('g:shader_monitor_watch_dir')
        \ && g:shader_monitor_watch_dir !=# ''
    let h = simplify(fnamemodify(
          \ expand(g:shader_monitor_watch_dir),
          \ ':p'
          \ ))
    return h
  endif

  let pr = simplify(shader_monitor#project_root())
  let sh = pr . '/shaders'
  silent! call mkdir(sh, 'p')
  return simplify(sh)
endfunction

function! shader_monitor#stop() abort
  if get(g:, 'shader_monitor_close_browser_on_stop', 1) && s:is_running != 0
    call s:http_post_close_pages()
  endif
  if has('nvim')
    if s:nvim_job_id > 0
      let l:pid = 0
      try
        let l:pid = jobpid(s:nvim_job_id)
      catch /.*/
      endtry
      try
        call jobstop(s:nvim_job_id)
      catch /.*/
      endtry
      if l:pid > 0 && (has('unix') || has('macunix') || executable('kill'))
        silent call system('kill -TERM ' . l:pid . ' 2>/dev/null')
      endif
    endif
    let s:nvim_job_id = -1
  elseif exists('*job_stop')

    try
      if exists('s:vim_job')
            \ && s:vim_job isnot v:null
        try
          silent! call job_stop(s:vim_job, 'term')
        catch /.*/
          silent! call job_stop(s:vim_job)
        endtry
      endif
    catch /.*/
    endtry
  endif

  let s:vim_job = v:null
  let s:is_running = 0
endfunction

function! shader_monitor#restart(expr) abort
  let t = shader_monitor#SxTrim(a:expr)
  let use = ''

  if strlen(t) > 0
    let use = t
  elseif strlen(s:last_watch) > 0
    let use = s:last_watch
  endif

  call shader_monitor#stop()
  call shader_monitor#start(use)
endfunction

function! shader_monitor#start(expr) abort
  if executable(g:shader_monitor_node_executable) != 1
    echoerr '[shader-monitor] Not in $PATH: '
          \ . g:shader_monitor_node_executable
    return
  endif

  if s:is_running != 0
    echohl WarningMsg
    echo '[shader-monitor] Already running (:ShaderMonitorStop).'
    echohl NONE
    return
  endif

  let root = simplify(shader_monitor#project_root())
  let srv = simplify(root . '/server.mjs')

  if filereadable(srv) != 1
    echoerr '[shader-monitor] Missing ' . srv
    return
  endif

  let watch = simplify(shader_monitor#normalize_watch(a:expr))
  let watch_dir = simplify(
        \ substitute(simplify(watch), '\v[/\\]$', '', ''))

  if strlen(watch_dir) == 0
    let watch_dir = simplify(watch)

  endif

  let s:last_watch = watch_dir

  let node = expand(g:shader_monitor_node_executable)

  let port = '' . g:shader_monitor_port

  let argv = [node, srv, watch_dir, '--port', port]
  let cwd = simplify(root)

  try
    if has('nvim')

      let o = {}
      let o.cwd = cwd
      let o.stdout_buffered = v:true
      let o.stderr_buffered = v:true
      let o.on_stdout = function('shader_monitor#noop')
      let o.on_stderr = function('shader_monitor#NxStderr')
      let o.on_exit = function('shader_monitor#NxExit')

      let jid = jobstart(argv, o)

      if jid <= 0
        echoerr '[shader-monitor] jobstart failed'
        return
      endif

      let s:nvim_job_id = jid
      let s:is_running = 1

    else
      if !exists('*job_start')
        echoerr '[shader-monitor] Needs Vim 8+ job_start or Neovim'
        return
      endif

      let jo = {}
      let jo.cwd = cwd
      let jo.out_io = 'null'
      let jo.err_io = 'null'
      let jo.exit_cb = function('shader_monitor#VxExit')

      let jb = job_start(argv, jo)

      let s:vim_job = jb
      let s:is_running = 1
    endif

    echom '[shader-monitor] ' . shader_monitor#base_url()
          \ . ' watches ' . watch_dir

    if g:shader_monitor_auto_open
      call shader_monitor#browser_open()
    endif
  catch /.*/
    let s:is_running = 0
    let s:nvim_job_id = -1
    let s:vim_job = v:null
    echohl WarningMsg
    echom '[shader-monitor] ' . v:exception
    echohl NONE
  endtry
endfunction
function! shader_monitor#CanonWatch(p) abort
  return simplify(
        \ substitute(
        \ simplify(fnamemodify(a:p, ':p')),
        \ '\v[/\\]$',
        \ '',
        \ 'g'
        \ ))
endfunction

" Relative path from watch root to file, forward slashes (matches /api/shaders list).
function! s:shader_rel_to_watch(watch_dir, abs_file) abort
  let rootl = tr(simplify(substitute(
        \ fnamemodify(a:watch_dir, ':p'), '\v[/\\]$', '', '')), '\', '/')
  let fl = tr(simplify(fnamemodify(a:abs_file, ':p')), '\', '/')
  let rp = rootl
  let fp = fl
  if has('win32') || has('win64')
    let rp = tolower(rootl)
    let fp = tolower(fl)
  endif
  if stridx(fp, rp) != 0
    return ''
  endif
  if fp ==# rp
    return ''
  endif
  if strlen(fp) <= strlen(rp) + 1 || strpart(fp, strlen(rp), 1) !=# '/'
    return ''
  endif
  return strpart(fl, strlen(rootl) + 1)
endfunction

function! s:url_query_value(s) abort
  let out = ''
  let i = 0
  let n = strlen(a:s)
  while i < n
    let c = strpart(a:s, i, 1)
    if c =~# '^[a-zA-Z0-9._~/-]$'
      let out .= c
    else
      let out .= printf('%%%02X', char2nr(c))
    endif
    let i += 1
  endwhile
  return out
endfunction

" Sets s:browser_open_query so browser_open() loads ?path=… for the current buffer.
function! s:apply_buffer_preview_query(watch_dir, abs_path) abort
  unlet! s:browser_open_query
  let rel = s:shader_rel_to_watch(a:watch_dir, a:abs_path)
  if rel ==# ''
    return
  endif
  let ext = tolower(fnamemodify(rel, ':e'))
  if ext !=# 'frag' && ext !=# 'glsl' && ext !=# 'vert'
    return
  endif
  let s:browser_open_query = 'path=' . s:url_query_value(rel)
endfunction

" Preview the directory of the current buffer (MarkdownPreview-style).
function! shader_monitor#preview_current() abort
  let file = expand('%:p')

  if file ==# ''
    echohl WarningMsg
    echom '[shader-monitor] Save the buffer first (needs a filesystem path).'
    echohl NONE
    return
  endif

  let dir = simplify(fnamemodify(file, ':p:h'))
  let want = shader_monitor#CanonWatch(dir)
  call s:apply_buffer_preview_query(want, file)

  if s:is_running != 0
    let have = shader_monitor#CanonWatch(s:last_watch)
    if have ==# want
      if get(g:, 'shader_monitor_preview_reopen_browser', 1)
        call shader_monitor#browser_open()
      endif
      return
    endif
    call shader_monitor#stop()
  endif

  call shader_monitor#start(dir)
endfunction

function! shader_monitor#preview_toggle() abort
  if s:is_running != 0
    call shader_monitor#stop()
    return
  endif
  call shader_monitor#preview_current()
endfunction

