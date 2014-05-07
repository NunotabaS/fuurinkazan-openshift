#!/bin/env node

var express = require('express');
var fs	  = require('fs');
var MongoClient = require('mongodb').MongoClient;
var ObjectID = require('mongodb').ObjectID;
var crypto = require('crypto');

var FuurinKazanKaze = function() {
	var self = this;
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
		self.status.machineName = process.env.MACHINE_NAME || (self.ipaddress + ":" + self.port);
		self.outdir = process.env.OPENSHIFT_DATA_DIR || (__dirname + "/uploads");
		process.env.TMPDIR = self.outdir;
	};
	self.loadDatabase = function(callback){
		MongoClient.connect('mongodb://'+self.connection_string, function(err, db) {
			if(err) {
				self.status.isUp = false;
				self.status.lastErr = err.toString();
				return;
			}
			callback(db);
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
			res.writeHead(200, {"Content-Type":"text/html"});
			res.end('<html>'+
				'<form action="/upload" method="POST" enctype="multipart/form-data">' +
				'<input type="file" name="upload"/>' +
				'<input type="submit" value="submit"/>' +
				'</form></html>');
		};
		
		self.routes.get['/status'] = function(req, res) {
			res.writeHead(200, {"Content-Type":"application/json"});
			self.setupFileCache(function(){
				res.end(JSON.stringify(self.status));
			});
		};
		
		self.routes.get['/get/:tag'] = function(req, res) {
			var tag = req.params.tag;
			self.loadDatabase(function(db){
				db.collection("files").findOne({_id:ObjectID(tag)}, function(err, data){
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
								var rs = fs.createReadStream(self.outdir + file); 
								rs.on("open",function(){
									res.writeHead(200, {"Content-Type":data.type});
									rs.pipe(res);
								});
								rs.on('error', function(err) {
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
		self.loadDatabase(function(db){
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

