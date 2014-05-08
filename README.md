Fuurinkazan-Openshift
=================================

这是一个动态文件上传服务的实现。Openshift服务器支持免费高达 1GB 的存储空间，
如果进行多服务器联动的话，就可以实现相当好的程度的视频挂载服务。

配布
--------------
配置非常简单，只需要你在 Openshift 上制作新的 Application，挂载一个 nodejs 0.10.0 的
卡片（Cartridge） + 一个MongoDB2.4 的 Cartridge即可。

在建立 Application 时还可选择从 Github 本项目直接导入代码。这样做你会得到一个Nodejs的已经配置
好本软件的卡片。不过这个卡片没有带数据库，所以你要手动添加数据库后，点击右上角restart application

别处配布
--------------
本应用不依赖OpenShift，如果希望在别处配布（如虚拟主机，EC2等），请参考如下步骤：

- 首先确保安装有 Node.js (v0.10) 或以上和 npm 包管理器。
- 运行 `npm install` 来导入最新的库
- 打开 `deploy.sh` 更改相应的变量，如果你的 Mongodb和你的 Node在同一台机器上，那么记住Mongodb
也要配置好
- 运行 `deploy.sh &` 来启动。如果希望长期自动启动，还可以考虑用 Nodejs 的监听库，和把应用设置
为一个服务。

接口
--------------
提供的基础接口如下：

- `GET /`
	告诉你这里什么也没有

- `GET /status`
	返回服务器信息，比如有多少文件，总硬盘空间占用等等等等。
	
- `GET /get/:id`
	通过文件ID获取一个文件，支持Range头可动态。

- `GET /list` `?skip=0limit=200`
	返回服务器文件列表。一次最多200条，可以设置 limit <= 200, skip = k 跳过记录。默认是 200,0

- `POST /upload`
	上传文件，区域 upload。上传后会返回文件的访问信息
	
- `GET /html/upload`
	上传文件UI界面，用于调试

- `GET /html/key`
	上传新的keyfile

- `POST /key`
	上传一个钥匙文件于 keyfile ，上传旧的钥匙文件于 oldkeyfile。如果 keyfile 非空，则会要求
	加密所有非 `/get/:id` 通讯。同时 `/get/:id` 需要 keyfile 的信息。第一次部署请上传同样的
	keyfile和oldkeyfile
