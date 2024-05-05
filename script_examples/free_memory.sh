# use single quotes to deal with special chars like $
curl -i -X POST http://127.0.0.1:8188/free \
-H 'Content-Type: application/json' \
-H 'Authorization: Bearer $2b$12$qUfJfV942nrMiX77QRVgIuDk1.oyXBP7FYrXVEBqouTk.uP/hiqAK' \
-d '{"unload_models": true, "free_memory": true}'
