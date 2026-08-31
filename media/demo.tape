Output media/demo.gif

Set Shell "bash"
Set FontSize 18
Set Width 1200
Set Height 700
Set Padding 20
Set Theme "Dracula"

Hide
Type "cd /tmp/fastify-ep-demo && clear"
Enter
Sleep 500ms
Show

Type "fastify-ep init demo-app --pm npm"
Enter
Sleep 2s

Type "cd demo-app"
Enter
Sleep 500ms

Type "fastify-ep generate module orders"
Enter
Sleep 2s

Type "ls src/modules"
Enter
Sleep 2s
