if exists('g:loaded_shader_monitor')
  finish
endif
let g:loaded_shader_monitor = 1

if !exists('g:shader_monitor_port')
  let g:shader_monitor_port = 3847
endif
if !exists('g:shader_monitor_host')
  let g:shader_monitor_host = '127.0.0.1'
endif
if !exists('g:shader_monitor_auto_open')
  let g:shader_monitor_auto_open = 1
endif
if !exists('g:shader_monitor_stop_on_leave')
  let g:shader_monitor_stop_on_leave = 1
endif
if !exists('g:shader_monitor_watch_dir')
  let g:shader_monitor_watch_dir = ''
endif
if !exists('g:shader_monitor_project_root')
  let g:shader_monitor_project_root = ''
endif
if !exists('g:shader_monitor_node_executable')
  let g:shader_monitor_node_executable = 'node'
endif

if !exists('g:shader_monitor_preview_reopen_browser')
  let g:shader_monitor_preview_reopen_browser = 1
endif
if !exists('g:shader_monitor_preview_default_mappings')
  let g:shader_monitor_preview_default_mappings = 0
endif

if !exists('g:shader_monitor_open_new_window')
  let g:shader_monitor_open_new_window = 1
endif
if !exists('g:shader_monitor_browser_cmd')
  let g:shader_monitor_browser_cmd = ''
endif
if !exists('g:shader_monitor_close_browser_on_stop')
  " Like markdown-preview.nvim: notify preview to close before killing the job (POST /api/close-pages).
  let g:shader_monitor_close_browser_on_stop = 1
endif

command! -nargs=? -complete=file ShaderMonitorStart call shader_monitor#start(<q-args>)

command! ShaderMonitorStop call shader_monitor#stop()

command! ShaderMonitorOpen call shader_monitor#browser_open()

command! -nargs=? -complete=file ShaderMonitorRestart call shader_monitor#restart(<q-args>)

command! ShaderMonitorStatus echom shader_monitor#status_line()

" Markdown Preview-style commands and <Plug> maps.
command! ShaderPreview call shader_monitor#preview_current()
command! ShaderPreviewStop call shader_monitor#stop()
command! ShaderPreviewToggle call shader_monitor#preview_toggle()

nnoremap <silent> <Plug>(ShaderPreview) :ShaderPreview<CR>
nnoremap <silent> <Plug>(ShaderPreviewStop) :ShaderPreviewStop<CR>
nnoremap <silent> <Plug>(ShaderPreviewToggle) :ShaderPreviewToggle<CR>

if get(g:, 'shader_monitor_preview_default_mappings', 0)
  nmap <silent> <Leader>sv <Plug>(ShaderPreview)
  nmap <silent> <Leader>sV <Plug>(ShaderPreviewStop)
  nmap <silent> <Leader>st <Plug>(ShaderPreviewToggle)
endif

augroup ShaderMonitorLeave
  autocmd!
  if get(g:, 'shader_monitor_stop_on_leave', 1)
    autocmd VimLeavePre * call shader_monitor#stop()
  endif
augroup END
