const app = require('http').createServer();
const io = require('socket.io')(app);
const express = require('express');
const path = require('path');
const webApp = express();
const sqlite3 = require('sqlite3').verbose();
let db = new sqlite3.Database(path.join(__dirname, 'db'));

const initializeWeb = () => {
    const sql = "CREATE TABLE IF NOT EXISTS devices (id INTEGER PRIMARY KEY AUTOINCREMENT, hostname VARCHAR(255) null, mac varchar(255) null, ip varchar(255) null , secret varchar(255) null, online boolean default false, authorized boolean default false , denied boolean default false, updated_at timestamp default CURRENT_TIMESTAMP)";
    return new Promise((resolve, reject) => {
        db.run(sql, (error) => {
            if (error) reject(error);
            resolve()
        })
    });
};
const insertDevice = (hostname, mac, ip, secret) => {
    const sql = 'INSERT INTO devices (hostname, mac, ip, secret, online) values (?, ?, ?, ?,?)';
    return db.run(sql, [hostname, mac, ip, secret, true]);
};
const findDevice = (mac, secret) => {
    return new Promise((resolve, reject) => {
        const sql = "select * FROM devices where mac = ? and secret = ?";
        db.get(sql, [mac, secret], (err, result) => {
            if (err) reject(err);
            resolve(result)
        })
    });
};
const findDeviceByDeviceID = id => {
    return new Promise((resolve, reject) => {
        const sql = "select * FROM devices where id = ?";
        db.get(sql, [id], (err, result) => {
            if (err) reject(err);
            resolve(result)
        })
    });
};
const setOnline = (id, online) => {
    const sql = "UPDATE devices set online = ? where id = ?";
    db.run(sql, [online, id]);
};
const deviceIsOnline = id => {
    return new Promise((resolve, reject) => {
        const sql = "select * FROM devices where id = ? and online = true";
        db.get(sql, [id], (err, result) => {
            if (err) reject(err);
            resolve(result)
        })
    });
};
const getAllDevices = () => {
    return new Promise((resolve, reject) => {
        const sql = "SELECT * FROM devices where (authorized = true or authorized = false) and denied = false";
        db.all(sql, (err, result) => {
            if (err) reject(err);
            resolve(result);
        })
    });
};
const setDeviceParams = (authorized, denied, id) => {
    const setAuthorizedSql = "UPDATE devices set authorized = ? where id = ?";
    const setDeniedSql = "UPDATE devices set denied = ? where id = ?";
    db.run(setAuthorizedSql, [authorized, id]);
    db.run(setDeniedSql, [denied, id]);
};

webApp.use(express.json());
webApp.use(express.static(path.join(__dirname, 'public')));

let socketMap = [];

io.on('connection', function (socket) {
    let deviceId = null;
    console.log('Client Connected: ' + socket.handshake.address);
    socket.on('SEND_INFO', (data) => {
        findDevice(data.mac, data.secret).then(device => {
            if (device) {
                deviceId = device.id;
                console.log('Device already on server db..');
                setOnline(device.id, true);
                socketMap.push({
                    deviceID: device.id,
                    socket: socket
                });
            } else {
                console.log('New device, adding to db...');
                insertDevice(data.hostname, data.mac, data.ip, data.secret);
                findDevice(data.mac, data.secret).then(device => {
                    deviceId = device.id;
                    socketMap.push({
                        deviceID: device.id,
                        socket: socket
                    });
                }).catch(e => {
                    console.error(e);
                })
            }
        }).catch(e => {
            console.error(e);
        });
    });

    let intRef = null;
    intRef = sendPing(socket, 2000);

    socket.on('disconnect', (reason) => {
        console.log(reason.toString());
        clearInterval(intRef);
        if (deviceId !== null) {
            console.log(`Device with id ${deviceId} disconnected.`);
            setOnline(deviceId, false);
            socketMap = socketMap.filter(m => m.deviceID !== deviceId)
        }
    });
});
const sendPing = (socket, heartbeatInterval) => {
    return setInterval(() => {
        socket.emit('check_alive', {key: genRandomKey()});
    }, heartbeatInterval)
};
const genRandomKey = () => {
    return Math.random().toString(36).substr(2);
};

webApp.get('/api/devices', (req, res) => {
    getAllDevices().then(devices => {
        res.status(200).json({
            devices: devices,
            count: devices.length
        });
    }).catch(e => {
        res.status(500).json({status: 'fail'});
    })
});
webApp.post('/api/devices/wipe', (req, res) => {
    let deviceID = req.body.deviceID;
    if (deviceID) {
        console.log(`Wipe request for deviceID: ${deviceID}`);
        deviceIsOnline(deviceID).then(device => {
            console.log(`Device is online: ip: ${device.ip}, mac: ${device.mac}`);
            console.log(`Sending wipe request to ${device.mac}`);
            socketMap.forEach(sm => {
                if (sm.deviceID === deviceID) {
                    sm.socket.emit('WIPE_REQUEST', {scope: 'documents'});
                    return res.status(200).json({status: 'success'});
                }
            });
        }).catch(e => {
            console.error(`Failed to send wipe request!`);
            console.error(e);
            return res.status(422).json({status: 'fail', msg: 'Requested device is not online!'});
        });
    } else {
        return res.status(422).json({status: 'fail', msg: `Device with ID: ${deviceID} not found!`});
    }

});
webApp.post('/api/devices/authorize', (req, res) => {
    let deviceID = req.body.deviceID;
    if (deviceID) {
        setDeviceParams(true, false, deviceID);
        res.status(200).json({status: 'success'});
    } else {
        res.status(422).json({status: 'fail'});
    }
});
webApp.post('/api/devices/reject', (req, res) => {
    let deviceID = req.body.deviceID;
    if (deviceID) {
        setDeviceParams(false, true, deviceID);
        res.status(200).json({status: 'success'});
    } else {
        res.status(422).json({status: 'fail'});
    }
});

app.listen(3000, () => {
    console.debug('Listening on port 3000')
});
webApp.listen(4000, () => {
    initializeWeb().then(() => {
        console.debug('Listening on port 4000')
    }).catch(e => {
        console.error(e);
    })
});