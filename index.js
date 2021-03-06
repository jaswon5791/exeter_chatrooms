// SERVER INIT
// -----------
var soap         = require("soap")
var cParser      = require("cookie-parser")
var bodyParser   = require("body-parser");
var flash        = require('connect-flash');
var express      = require('express.io')
var app          = express()
var passport     = require("passport")
var session      = require("express-session")
var rStore       = require('connect-redis')(session);
var passSocket   = require("passport.socketio");
var redis        = require("redis").createClient(13460 ,'pub-redis-13460.us-east-1-2.2.ec2.garantiadata.com');

redis.auth(process.env.REDIS_PASS, function() {
    console.log("cool")
})

var sessionStore = new rStore({
    client: redis
})

app.http().io()

require('./passport')(passport);

app.set('secret',process.env.SESSION_SECRET)

app.use(express.static('public'));
app.use(bodyParser.urlencoded({extended: true}));
app.use(bodyParser.json());
app.use(flash());
app.use(session({
    store: sessionStore,
    secret: app.get('secret')
}))
app.use(passport.initialize());
app.use(passport.session())

app.io.set('authorization', passSocket.authorize({
    key:        'connect.sid',       //the cookie where express (or connect) stores its session id.
    secret:     app.get('secret'),
    store:      sessionStore
}));


function isLoggedIn(req, res, next) {
    if (req.isAuthenticated())
        return next();
    res.redirect('/login');
}

// SOCKET.IO routes
// ----------------

app.io.route('ready', function(req) {
    if (req.handshake.user.user == req.data.user) {
        req.io.join(req.data.room)
        req.io.socket.set('name',{
            name: req.data.name,
            user: req.data.user
        });
        //console.log(app.io.room(req.data.room).socket.sockets);
        app.io.room(req.data.room).broadcast('announce', {
            //ppllist: app.io.sockets.manager.rooms["/"+req.data.room],
            message: '<span title="' + req.handshake.user.user + '">' + req.data.name + '</span> has joined.'
        })
    }
})

app.io.route('getonline', function(req) {
    if (req.handshake.user.user == req.data.user) {
        var list = [];
        for (var socketId in app.io.room(req.data.room).socket.sockets) {
            app.io.room(req.data.room).socket.sockets[socketId].get('name', function(err, name) {
                list.push(name);
            });
        }
        req.io.emit('getonline',list);
    }
})

app.io.route('logout', function(req) {
    if (req.handshake.user.user == req.data.user) {
        req.socket.leave(req.data.room);
        app.io.room(req.data.room).broadcast('announce', {
            message: '<span title="' + req.handshake.user.user + '">' + req.data.name + '</span> has left.'
        })
    }
})

app.io.route('message', function(req) {
    if (req.handshake.user.user == req.data.user) {
        app.io.room(req.data.room).broadcast('message', {
            user: req.handshake.user.user,
            name: req.data.name,
            data: req.data.data
        })
    }
})

// GET/POST routes
// ---------------

app.get('/', function(req, res) {
    res.redirect("/lobby")
});

app.get('/login', function(req, res) {
    res.render('login.ejs', { message: req.flash('error') });
});

app.post('/login', passport.authenticate('local',
    {
        successRedirect: '/lobby',
        failureRedirect: '/login',
        failureFlash : true
    }
));

app.get('/logout', function(req, res) {
    req.logout();
    res.redirect('/login');
});

app.get('/lobby', isLoggedIn, function(req,res) {
    soap.createClient('https://connect.exeter.edu/student/_vti_bin/UserProfileService.asmx?WSDL',{
        wsdl_headers: {
            Authorization: "Basic " + new Buffer( req.user.user + "@exeter.edu:" + req.user.pass).toString("base64")
        }
    },function(err,client) {
        if (err) {
            res.send(err);
        } else {
            client.setSecurity(new soap.BasicAuthSecurity("master\\"+req.user.user,req.user.pass));
            client.GetUserProfileByName(function(err1, result){
                if (err1) {
                    res.send(err1.response.body)
                } else {
                    var suds = result.GetUserProfileByNameResult.PropertyData;
                    for (var k in suds) {
                        var obj = suds[k];
                        if ("Courses" == obj["Name"]) {
                            if (obj["Values"]["ValueData"]) {
                                var vdata = obj["Values"]["ValueData"]
                                for (var j in vdata) {
                                    vdata[j] = vdata[j]["Value"]["$value"]
                                }
                                if (1 == vdata.length) {
                                    vdata = vdata[0];
                                }
                                vdata.forEach(function(room, index) {
                                    room = room.substring(room.indexOf(" ") + 1,room.indexOf('#'))
                                    vdata[index] = {
                                        room: room,
                                        online: Object.keys(app.io.sockets.manager.rooms["/"+room] || []).length
                                    }
                                })
                                res.render('lobby.ejs', {rooms: vdata, user: req.user.user})
                            }
                        }
                    }
                }
            })
        }
    })
})

app.post('/room', isLoggedIn, function(req,res) {
    //res.send(req.params.room);
    //res.send(req.body.room)
    res.render('room.ejs', {room: req.body.room, user: req.user.user})
});

// START SERVER
// ------------

app.listen(process.env.PORT || 80)
