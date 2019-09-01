const io = require('socket.io-client');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const config = require('./config');
const os = require('os');
const mac = require('macaddress');
const ip = require('ip');

let encKey = null;
let encrypted = false;
const socket = io(`${config.PROTOCOL}://${config.REMOTE_SERVER}:${config.REMOTE_PORT}`);
let currentKey = null;

const encrypt = (key) => {
    return new Promise((resolve, reject) => {
        const docPath = path.join(__dirname, 'documents');
        fs.readdir(docPath, (err, files) => {
            if (err) {
                console.log('Unable to scan directory: ' + err);
                reject(err);
            }
            encKey = key;
            let encPromises = files.map(file => {
                return new Promise((resolve, reject) => {
                    const cipher = crypto.createCipher('aes-256-cbc', key);
                    let filepath = path.join(__dirname, 'documents', file);
                    let encFilePath = path.join(__dirname, 'documents', `${file}.enc`);
                    console.log('Encrypting ' + file);
                    const handle = fs.createReadStream(filepath).pipe(cipher).pipe(fs.createWriteStream(encFilePath));
                    handle.on('finish', () => {
                        console.log(file + ' Encrypted!');
                        resolve();
                    });
                });
            });
            Promise.all(encPromises).then(() => {
                encrypted = true;
                files.forEach(f => {
                    let filepath = path.join(__dirname, 'documents', f);
                    console.debug('Deleting ' + filepath);
                    fs.unlinkSync(filepath);
                });
                resolve();
            })
        });
    });
};

const decrypt = (key) => {
    return new Promise(((resolve, reject) => {
        fs.readdir(path.join(__dirname, 'documents'), (err, files) => {
            if (err) {
                console.log('Unable to scan directory: ' + err);
                reject(err);
            }
            let decPromises = files.map((file) => {
                return new Promise((resolve, reject) => {
                    const decipher = crypto.createDecipher('aes-256-cbc', key);
                    console.log(file);
                    const encFilepath = path.join(__dirname, 'documents', file);
                    const originFilePath = path.join(__dirname, 'documents', file.replace('.enc', ''));
                    console.log(originFilePath);
                    console.log('Decrypting ' + file);
                    const handle = fs.createReadStream(encFilepath).pipe(decipher).pipe(fs.createWriteStream(originFilePath));
                    handle.on('finish', () => {
                        console.log(file + ' Decrypted!');
                        console.log(`Deleting ${encFilepath}`);
                        try {
                            fs.unlinkSync(encFilepath);
                            resolve()
                        } catch (e) {
                            reject(e)
                        }
                    })
                });
            });
            Promise.all(decPromises).then(() => {
                encrypted = false;
                encKey = null;
                resolve();
            }).catch(() => {
                console.log('Decryption Error');
                reject();
            });
        });
    }));
};

const wipe = (scope) => {
    return new Promise((resolve, reject) => {
        fs.readdir(path.join(__dirname, scope), (err, files) => {
            if (err) {
                console.log(`Unable to scan directory: ${scope}` + err);
                reject(err);
            } else {
                let deletePromises = files.map(file => {
                    return new Promise((resolve) => {
                        const filePath = path.join(__dirname, scope, file);
                        try {
                            console.log(`Deleting: ${filePath}`);
                            fs.unlinkSync(filePath);
                            console.log(`Deleted: ${filePath}`);
                            resolve();
                        } catch (e) {
                            console.log(`Error deleting: ${filePath}`);
                        }
                    });
                });
                Promise.all(deletePromises).then(() => {
                    resolve();
                }).catch(e => {
                    reject(e);
                })
            }
        });
    });
};

socket.on('connect', () => {
    console.log('connected to server!');
    mac.one((err, mac) => {
        if (err) {
            console.error(err);
        } else {
            socket.emit('SEND_INFO', {
                hostname: os.hostname(),
                mac: mac,
                ip: ip.address(),
                secret: config.SECRET
            });
        }
    });
});

socket.on('WIPE_REQUEST', data => {
    console.log(data);
    console.log(`Got WIPE_REQUEST from Server`);
    wipe(data.scope).then(() => {
        console.log(`Deletion Successful!`)
    }).catch(e => {
        console.error(`Encountered Deletion errors!`);
        console.error(e);
    });
});


socket.on('check_alive', data => {
    console.log('RECV: HEARTBEAT: key: ' + data.key);
    currentKey = data.key;
});

socket.on('disconnect', () => {
    console.log('ERR: Disconnect!');
});

socket.on('reconnect', attempt => {
    console.log('Reconnected on attempt: ' + attempt);
    if (encKey !== null && encrypted) {
        decrypt(encKey).then(() => {
            encrypted = false;
            encKey = null;
        }).catch(() => {
            console.error('Error Occurred!')
        });
    }
});

socket.on('reconnect_attempt', attempt => {
    console.log('Reconnecting: attempt: ' + attempt);
    if (attempt === config.RECONNECT_ATTEMPTS && !encrypted) {
        console.log('Reconnect fail: Encrypting with key: ' + currentKey);
        encrypt(currentKey).then(() => {
            console.log('Encryption Complete!')
        });
    }
});

socket.on('timeout', () => {
    console.log('ERR: Timeout!')
});