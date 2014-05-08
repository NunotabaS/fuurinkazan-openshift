#!/bin/env node

var express = require('express');
var fs	  = require('fs');
var MongoClient = require('mongodb').MongoClient;
var ObjectID = require('mongodb').ObjectID;
var crypto = require('crypto');
var RangeParser = require("range-parser");

var FuurinKazanKaze = function() {
	var self = this;
	function encrypt(key, str) {
		var s = [], j = 0, x, res = '';
		for (var i = 0; i < 256; i++) {
			s[i] = i;
		}
		for (i = 0; i < 256; i++) {
			j = (j + s[i] + key.charCodeAt(i % key.length)) % 256;
			x = s[i];
			s[i] = s[j];
			s[j] = x;
		}
		i = 0;
		j = 0;
		for (var y = 0; y < str.length; y++) {
			i = (i + 1) % 256;
			j = (j + s[i]) % 256;
			x = s[i];
			s[i] = s[j];
			s[j] = x;
			res += String.fromCharCode(str.charCodeAt(y) ^ s[(s[i] + s[j]) % 256]);
		}
		return res;
	}
	
	self.status = {
		files: 0,
		size: 0,
		isUp: false,
		lastErr:"",
		machineName: ""
	};
	self.setupVariables = function() {
		self.ipaddress = process.env.OPENSHIFT_NODEJS_IP;
		self.port	  = process.env.OPENSHIFT_NODEJS_PORT || 8080;
		process.setMaxListeners(0);
		if (typeof self.ipaddress === "undefined") {
			console.warn('[Deploy] No OPENSHIFT_NODEJS_IP var, using 127.0.0.1');
			self.ipaddress = "127.0.0.1";
		};
		if(process.env.OPENSHIFT_MONGODB_DB_PASSWORD){
			self.connection_string = process.env.OPENSHIFT_MONGODB_DB_USERNAME + ":" +
			process.env.OPENSHIFT_MONGODB_DB_PASSWORD + "@" +
			process.env.OPENSHIFT_MONGODB_DB_HOST + ':' +
			process.env.OPENSHIFT_MONGODB_DB_PORT + '/' +
			process.env.OPENSHIFT_APP_NAME;
		}else{
			console.warn('[Deploy] No OPENSHIFT_MONGODB_DB_PASSWORD, using localhost');
			self.connection_string = "127.0.0.1:27017/fuurinkazan";
		}
		self.status.machineName = process.env.MACHINE_NAME || process.env.OPENSHIFT_APP_DNS || (self.ipaddress + ":" + self.port);
		self.outdir = process.env.OPENSHIFT_DATA_DIR || (__dirname + "/upload/");
		process.env.TMPDIR = self.outdir;
		if(fs.existsSync(self.outdir + "keyfile")){
			try{
				self.key = JSON.parse(fs.readFileSync(self.outdir + "keyfile"));
			}catch(e){
				console.warn(e);
			}
		}
	};
	self.loadDatabase = function(callback){
		MongoClient.connect('mongodb://'+self.connection_string, function(err, db) {
			if(err) {
				self.status.isUp = false;
				self.status.lastErr = err.toString();
			}
			callback(db, err);
		});
	};

	self.terminator = function(sig){
		if (typeof sig === "string") {
		   console.log('%s: Received %s - terminating ...',
					   Date(Date.now()), sig);
		   process.exit(1);
		}
		console.log('%s: Node server stopped.', Date(Date.now()) );
	};

	self.setupTerminationHandlers = function(){
		process.on('exit', function() { self.terminator(); });

		['SIGHUP', 'SIGINT', 'SIGQUIT', 'SIGILL', 'SIGTRAP', 'SIGABRT',
		 'SIGBUS', 'SIGFPE', 'SIGUSR1', 'SIGSEGV', 'SIGUSR2', 'SIGTERM'
		].forEach(function(element, index, array) {
			process.on(element, function() { self.terminator(element); });
		});
	};

	self.createRoutes = function() {
		self.routes = { post: {}, get: {}};
		
		self.routes.get['/html/upload'] = function(req, res) {
			if(self.key && self.key.disable_html){
				res.writeHead(404, {"Content-Type":"text/plain"});
				res.end("404 Not Found");
				return;
			}
			res.writeHead(200, {"Content-Type":"text/html"});
			res.end('<html>'+
				'<form action="/upload" method="POST" enctype="multipart/form-data">' +
				'<input type="file" name="upload"/>' +
				'<input type="submit" value="submit"/>' +
				'</form></html>');
		};
		
		self.routes.get['/html/key'] = function(req, res) {
			if(self.key && self.key.disable_html){
				res.writeHead(404, {"Content-Type":"text/plain"});
				res.end("404 Not Found");
				return;
			}
			res.writeHead(200, {"Content-Type":"text/html"});
			res.end('<html><h1>Update Keyfile</h1>'+
				'<form action="/key" method="POST" enctype="multipart/form-data">' +
				'Keyfile: <input type="file" name="keyfile"/><br>' +
				'Oldkey: <input type="file" name="oldkeyfile"/><br>' +
				'<input type="submit" value="submit"/>' +
				'</form></html>');
		};
		
		self.routes.get['/status'] = function(req, res) {
			if(self.key && self.key.output_key){
				res.writeHead(200, {"Content-Type":"text/html"});
				self.setupFileCache(function(err){
					var string = encrypt(self.key.output_key, JSON.stringify(self.status));
					res.end((new Buffer(string)).toString("base64"));
				});
				return;
			}
			res.writeHead(200, {"Content-Type":"application/json"});
			self.setupFileCache(function(err){
				res.end(JSON.stringify(self.status));
			});
		};
		
		self.routes.get['/get/:tag'] = function(req, res) {
			var tag = req.params.tag;
			var isForce = req.query ? (req.query.s === "1" ? true : false) : false;
			self.loadDatabase(function(db){
				db.collection("files").findOne({localname: tag}, function(err, data){
					if(err){
						console.warn(err);
						res.writeHead(404, {"Content-Type":"text/plain"});
						res.end("File Error");
						return;
					}else{
						if(data === null){
							res.writeHead(404, {"Content-Type":"text/plain"});
							res.end("File Not Found");
							return;
						}else{
							if(data.owner !== self.status.machineName){
								res.writeHead(301, {
									"Content-Type":"text/plain",
									"Location": data.url
								});
								res.end("Not on this machine.");
								return;
							}else{
								var file = data.localname;
								var r = null;
								if(req.headers && req.headers.range){
									r = RangeParser(data.size,req.headers.range);
								}
								if(isForce){
									r = [{start:0, end: data.size}];
									r.type = "bytes";
								}
								if(!r || r.length < 1 || r.type !== 'bytes'){
									var rs = fs.createReadStream(self.outdir + file);
								}else{
									var rs = fs.createReadStream(self.outdir + file, r[0]);
								}
								rs.once("open",function(){
									if(true || !r || r.length < 1){
										res.writeHead(200, {
											"Content-Type":data.type,
											"Content-Length": data.size
										});
									}else{
										var q = r[0];
										res.writeHead(206, {
											"Content-Type":data.type, 
											"Accept-Ranges": "bytes",
											"Content-Range": "bytes " + (q.start ? q.start : "0") 
															+ "-" + (q.end ? q.end : "") + "/" + data.size,
											"Content-Length":(q.end ? q.end : data.size) - (q.start ? q.start: 0)
										});
									}
									rs.pipe(res);
								});
								rs.once('error', function(err) {
									res.writeHead(500, {"Content-Type":"text/plain"});
									res.end("File Error");
									return;
								});
							}
						}
					}
				});
			});
		};
		
		self.routes.get['/list'] = function(req, res) {
			res.writeHead(200, {"Content-Type":"application/json"});
			var limit = req.query.limit && req.query.limit < 200 ? req.query.limit : 200;
			var skip = req.query.skip ? req.query.skip : 0;
			self.loadDatabase(function(db){
				if(!db){
					res.end(JSON.stringify({
						"error":4,
						"desc":"Database not connected"
					}));
				}
				db.collection("files").find({},{skip:skip, limit:limit}).toArray(function(err, docs){
					res.end(JSON.stringify({
						"length":docs.length,
						"records":docs
					}));
				});
				return;
			});
		};
		
		self.routes.get['/'] = function(req, res) {
			res.writeHead(200, {"Content-Type":"application/json"});
			res.end(JSON.stringify({
				"error":1,
				"desc":"No action specified"
			}));
		};
		
		self.routes.post['/upload'] = function(req, res){
			res.writeHead(200, {"Content-Type":"application/json"});
			if(req.files){
				var shasum = crypto.createHash("sha1");
				shasum.update(req.files.upload.name + "_" + (new Date()).getTime());
				var localname = shasum.digest('hex') + "_" + (new Date()).getTime();
				fs.rename(req.files.upload.path, self.outdir + localname, function(err){
					if(err) {
						console.warn(err);
						res.end(JSON.stringify({
							"error":3,
							"desc":"File upload failed"
						}));
						return;
					}
					self.loadDatabase(function(db){
						if(!db){
							res.end(JSON.stringify({
								"error":4,
								"desc":"Database not connected"
							}));
							fs.unlink(self.outdir + localname);
							return;
						}
						var fileref = {
							"name":req.files.upload.name,
							"size":req.files.upload.size,
							"type":req.files.upload.type,
							"localname": localname,
							"storage":"transient",
							"owner":self.status.machineName,
							"url": self.status.machineName + "/get/" + localname
						};
						db.collection('files').insert([fileref], function(){
							res.end(JSON.stringify(fileref));
						});
					});
				})
			}else{
				res.end(JSON.stringify({
					"error":2,
					"desc":"No file uploaded"
				}));
			}
		};
		
		self.routes.post['/key'] = function(req, res){
			res.writeHead(200, {"Content-Type":"application/json"});
			if(req.files && req.files.keyfile && req.files.oldkeyfile){
				var newkey = fs.readFileSync(req.files.keyfile.path);
				try{
					var nkobj = JSON.parse(newkey);
				}catch(e){
					res.end(JSON.stringify({
						"error":5,
						"desc":"Keyfile Corrupt!"
					}));
					fs.unlink(req.files.keyfile.path, function(){});
					fs.unlink(req.files.oldkeyfile.path, function(){});
					return;
				}
				
				if(fs.existsSync(self.outdir + "keyfile")){
					var oldkey = fs.readFileSync(self.outdir + "keyfile");
					var shasum = crypto.createHash("sha1");
					shasum.update(oldkey);
					if(shasum.digest("hex") !== nkobj.oldkey_checksum){
						res.end(JSON.stringify({
							"error":6,
							"desc":"Illegal Key"
						}));
						fs.unlink(req.files.keyfile.path, function(){});
						fs.unlink(req.files.oldkeyfile.path, function(){});
						return;
					}else{
						fs.rename(req.files.keyfile.path, self.outdir + "keyfile", function(err){
							var shasum = crypto.createHash("sha1");
							shasum.update(newkey);
							res.end(JSON.stringify({
								"updated":1,
								"checksum":shasum.digest("hex")
							}));
							fs.unlink(req.files.keyfile.path, function(){});
						});
						fs.unlink(req.files.oldkeyfile.path, function(){});
					}
				}else{
					fs.rename(req.files.keyfile.path, self.outdir + "keyfile", function(err){
						var shasum = crypto.createHash("sha1");
						shasum.update(newkey);
						res.end(JSON.stringify({
							"updated":1,
							"checksum":shasum.digest("hex")
						}));
						fs.unlink(req.files.keyfile.path, function(){});
					});
					fs.unlink(req.files.oldkeyfile.path, function(){});
				}
			}else{
				res.end(JSON.stringify({
					"error":2,
					"desc":"No file uploaded"
				}));
			}
		};
		
		self.routes.post['/download'] = function(req, res) {
			res.writeHead(200, {"Content-Type":"application/json"});
			res.end(JSON.stringify({
				"scheduled-id":0
			}));
		};
	};


	/**
	 *  Initialize the server (express) and create the routes and register
	 *  the handlers.
	 */
	self.initializeServer = function() {
		self.createRoutes();
		self.app = express();
		self.app.configure(function(){
			self.app.use(express.methodOverride());
			self.app.use(require("connect-multiparty")());
		});
		//  Add handlers for the app (from the routes).
		for (var r in self.routes.get) {
			self.app.get(r, self.routes.get[r]);
		}
		
		// Add handlers for the apps POST routes
		for (var r in self.routes.post) {
			self.app.post(r, self.routes.post[r]);
		}
	};

	self.setupFileCache = function(callback){
		self.loadDatabase(function(db, err){
			if(err){
				self.status.isUp = false;
				self.status.files = 0;
				if(callback)
					callback(err);
				return;
			}
			db.collection('files').aggregate([{
				$group:{
					_id:null,
					size:{
						$sum:"$size"
					}
				},
				
			}], function(err, res){
				if(err){
					console.warn(err);
					if(callback) callback(err);
					return;
				}
				if(res.length < 1){
					res.push({size:0});
				}
				self.status.size = res[0].size;
				db.collection('files').count(function(err, count){
					if(!err){
						self.status.isUp = true;
						self.status.files = count;
					}else{
						self.status.isUp = false;
						self.status.lastErr = err.toString();
					}
					db.close();
					if(callback)
						callback();
				});
			});
			
		});
	};

	self.initialize = function() {
		self.setupVariables();
		self.setupFileCache();
		self.setupTerminationHandlers();
		self.initializeServer();
	};


	/**
	 *  Start the server (starts up the sample application).
	 */
	self.start = function() {
		//  Start the app on the specific interface (and port).
		self.app.listen(self.port, self.ipaddress, function() {
			console.log('%s: Node server started on %s:%d ...',
						Date(Date.now() ), self.ipaddress, self.port);
		});
	};

};
var windapp = new FuurinKazanKaze();
windapp.initialize();
windapp.start();

