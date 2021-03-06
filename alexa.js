/* jshint -W097 */
/* jshint -W030 */
/* jshint strict: false */
/* jslint node: true */
/* jslint esversion: 6 */
"use strict";

const
    soef = require('soef'),
    Alexa = require('alexa-remote')
;

let alexa;
const
    SMART_HOME_DEVICES = 'smart-home-devices',
    ECHO_DEVICES = 'echo-devices',

    playerControls = {
        play: { val: false, common: { role: 'button.play'}},
        pause:{ val: false, common: { role: 'button.pause'}},
        next: { val: false, common: { role: 'button.next'}},
        previous: { val: false, common: { role: 'button.prev'}},
        forward: { val: false, common: { role: 'button.forward'}},
        rewind: { val: false, common: { role: 'button.reverse'}},
        volume: { val: 0, common: { role: 'level.volume', min: 0, max: 100}},
        shuffle: { val: false, common: { role: 'media.mode.shuffle'}},
        repeat: { val: false, common: { role: 'media.mode.repeat'}},
    },

    commands = {
    }

;

let refreshTimer = new soef.Timer();

let adapter = soef.Adapter(
    main,
    onStateChange,
    onObjectChange,
    onUnload,
    onUpdate,
    'alexa'
);

function onUnload(callback) {
    callback && callback();
}

function onUpdate(prevVersion ,aktVersion, callback) {
    /*if (prevVersion < 25) {
        return removeAllObjects(adapter, callback);
    }*/
    callback();
}

function onStateChange(id, state) {

    adapter.log.debug('State changed ' + id + ': ' + JSON.stringify(state));
    if (!state || state.ack) return;
    //let ar, [a, inst, dummy, deviceId, channel, subChannel] = ar = id.split('.');
    let func = devices.get(id.substr(8)).func;

    if (typeof func === 'function') func(state.val);

    if (id.indexOf('#trigger') !== -1) return;
    
    refreshTimer.set(() => {
        alexa.updateStates();
    }, 3000);
}

function onObjectChange(id, object) {
    adapter.log.debug('Object changed ' + id + ': ' + JSON.stringify(object));
    let ar = id.split('.');
    if (ar[2] === ECHO_DEVICES) {
        if (object === null) {
            //deleted
            return;
        }
        let device = alexa.serialNumbers[ar[3]];
        if (object && object.common && object.common.name) {
            if (typeof device.rename === 'function') device.rename (object.common.name);
        }
        return;
    }
    if (ar[2] === SMART_HOME_DEVICES) {
    }
}


function decrypt(str) {
    if (!str) str = "";
    try {
        var key = 159;
        var pos = 0;
        var ostr = '';
        while (pos < str.length) {
            ostr = ostr + String.fromCharCode(key ^ str.charCodeAt(pos));
            pos += 1;
        }
        return ostr;
    } catch (ex) {
        return '';
    }
}

function normalizeConfig(config) {
    config.email = decrypt(config.email);
    config.password = decrypt(config.password);
}

function setRequestResult(err, res) {
    if (!err) return;
    devices.root.setAndUpdate('requestResult', err);
}

Alexa.prototype.updateStates = function (callback) {
    if (!this.devices || !this.devices.length) return callback && callback();
    let self = this, i = 0;
    let dev = new devices.CDevice ('', '');

    (function doIt() {
        if (i >= self.devices.length) {
            return devices.update( () => {
                self.updateHistory(callback);
            });
        }
        let device = self.devices[i++];
        dev.setDeviceEx(ECHO_DEVICES + '\\.' + device.serialNumber);
        dev.set ('online', { val: device.online, role: 'indicator.connected' });
        dev.setName(device.accountName);

        self.getPlayerInfo(device, function(err, res) {
            if (err || !res || !res.playerInfo) return doIt();
            dev.setDeviceEx(ECHO_DEVICES + '\\.' + device.serialNumber);
            dev.setChannel('Player-Controls');
            if (res.playerInfo.volume) {
                dev.set('volume', { val: ~~res.playerInfo.volume.volume, ack: true });
                //let muted = res.playerInfo.volume.muted;
            }
            dev.set('pause', { val: res.playerInfo.state === 'PAUSED', ack: true });
            dev.set('play', { val: res.playerInfo.state === 'PLAYING', ack: true });
            dev.setChannel('Player-Info');
            if (res.playerInfo.state !== null) dev.set('status', { val: res.playerInfo.state, ack: true });
            if (device) doIt();
        });
    })();
};

Alexa.prototype.delayedCreateSmarthomeStates = function (delay, callback) {
    setTimeout(this.createSmarthomeStates.bind(this, callback), delay);
};

Alexa.prototype.createSmarthomeStates = function (callback) {
    this.getSmarthomeDevices((err, res) => {
        if (err || !res) return callback(err);
        let dev = new devices.CDevice(SMART_HOME_DEVICES, { type: 'device', common: { name: 'Smart Home Devices', role: 'device' }});

        dev.setf('deleteAll', { val: false, common: { role: 'button'}}, (val) => {
            this.deleteAllSmarthomeDevices((err, res) => {
                adapter.deleteDevice(SMART_HOME_DEVICES, () => {
                    this.delayedCreateSmarthomeStates(1000);
                });
            });
        });
        dev.setf('discoverDevices', { val: false, common: { name: 'Let Alexa search for devices', role: 'button'}}, (val) => {
            this.discoverSmarthomeDevice((err, res) => {
                this.delayedCreateSmarthomeStates();
            });
        });

        let all = soef.getProp (res, 'locationDetails.Default_Location.amazonBridgeDetails.amazonBridgeDetails') || [];
        let k = Object.keys(all);
        for (let i of k) {
            for (let n of Object.keys(all[i].applianceDetails.applianceDetails)) {
                let skill = all[i].applianceDetails.applianceDetails[n];
                dev.setChannel(skill.entityId, {
                    type: 'channel',
                    common: {
                        name: skill.modelName,
                        role: 'channel'
                    },
                    native: {
                        friendlyDescription: skill.friendlyDescription,
                        friendlyName: skill.friendlyName,
                        ids:  skill.additionalApplianceDetails.additionalApplianceDetails.ids,
                        object: n,
                        manufacturerName: skill.manufacturerName,
                    }
                });
                //dev.set('', { val: skill.isEnabled, type: 'channel' });
                dev.set('isEnabled', { val: skill.isEnabled, common: { role: 'indicator', write: false}});
                dev.setf('delete', { val: false, common: { role: 'button'}}, function (id, val) {
                    this.deleteSmarthomeDevice(n);
                    adapter.deleteChannel(SMART_HOME_DEVICES, id);
                }.bind(this, skill.entityId));
            }
        }
        devices.update(callback);
    });
};

Alexa.prototype.updateHistory = function (callback) {
    this.getHistory( { size: 3, filter: true }, function (err, res) {
        if (err || !res) return callback && callback();
        let dev = new devices.CDevice('history');
        dev.force = true;
        let i = res.length - 1;

        (function doIt() {
            if (i < 0) return callback && callback();

            let o = res[i--];
            let last = dev.get ('creationTime');
            if (last && last.val >= o.data.creationTimestamp) return doIt();

            dev.set ('name', o.name);
            dev.set ('creationTime', o.data.creationTimestamp);
            dev.set ('serialNumber', o.serialNumber);
            dev.set ('summary', o.description.summary);
            //dev.set ('json', { name: o.name, serialNumber: o.serialNumber, summary: o.description.summary});
            devices.update (doIt);
        })();
    });
};

Alexa.prototype.createStates = function (callback) {

    let self = this;
    let dev = new devices.CDevice(ECHO_DEVICES, { type: 'device', common: { name: 'Echo devices', type: 'device'}});
    let devset = dev.setf.bind(dev);
    let key = soef.ns.add(ECHO_DEVICES);
    adapter.objects.getObjectView('system', 'device', {startkey: key + '.', endkey: key + '.\u9999'}, (err, res) => {
        let re = new RegExp (adapter.namespace + '\.' + ECHO_DEVICES + '.\[^\.]+$');
        let existingIds = [];
        for (let o of res.rows) {
            existingIds.push(o.id);
        }
        res.rows = undefined;

        Object.keys (this.serialNumbers).forEach ((n) => {
            let device = this.serialNumbers[n];
            dev.setDeviceEx (ECHO_DEVICES + '\\.' + device.serialNumber, { type: 'device', common: {name: device._name}});
            let idx = existingIds.indexOf(soef.ns.with(ECHO_DEVICES + '.' + device.serialNumber));
            if (idx !== -1) existingIds.splice(idx, 1);

            // dev.setDevice(ECHO_DEVICES, { type: 'device', common: { name: 'Echo devices', type: 'device'}});
            // dev.setChannel(device.serialNumber, { type: 'device', common: { name: device._name, type: 'device' }});
            // dev.setChannel('');
            // dev.setDeviceEx (ECHO_DEVICES + '\\.' + device.serialNumber, { type: 'device', common: { name: device._name}});

            //dev.set ('', { val: device.online ? 'Online' : 'offline', type: 'device' });
            dev.set ('.requestResult', {val: '', common: {name: 'Request Result', write: false, role: 'text'}}); // TODO ???
            dev.set ('delete', {val: false, common: {name: 'Delete (Log out of this device)', role: 'button'}});

            dev.setChannel ('Info');
            dev.set ('capabilities', {val: device.capabilities.join (','), common: {role: 'text', write: false}});

            dev.setChannel ('Player-Info');
            dev.set('status', { val: '', ack: true });
            //TODO

            if (device.bluetoothState) {
                device.bluetoothState.pairedDeviceList.forEach ((bt) => {
                    dev.setChannel ('Bluetooth.' + bt.address, bt.friendlyName);
                    devset ('connected', {val: bt.connected, common: {role: 'switch'}}, bt.connect);
                    devset ('unpaire', {val: false, common: {role: 'button'}}, bt.unpaire);
                    //devset('connect', { val: false, common: { role: 'button'}}, bt.connect);
                    //devset('disconnect', { val: false, common: { role: 'button'}}, bt.connect);
                });
            }

            if (device.notifications) {
                dev.setChannel ('Notifications');
                for (let noti of device.notifications) {
                    if (noti.originalTime) {
                        let ar = noti.originalTime.split (':');
                        ar.length = 2;
                        let s = ar.join (':');
                        devset (s, {val: noti.status === 'ON', common: {type: 'mixed', role: 'state', name: `Type=${noti.type}`}}, noti.set);
                    }
                }
            }

            dev.setChannel ('Commands');
            for (let n in commands) {
                devset (n, JSON.parse (JSON.stringify (commands[n])), alexa.sendCommand.bind (alexa, device, n));
            }
            devset ('doNotDisturb', {val: false, common: {role: 'switch'}}, device.setDoNotDisturb);

            dev.setChannel ('Player-Controls');
            for (let n in playerControls) {
                devset (n, JSON.parse (JSON.stringify (playerControls[n])), alexa.sendCommand.bind (alexa, device, n));
            }

            if (device.capabilities.includes ('TUNE_IN')) {
                devset ('TuneIn', {val: '', common: {role: 'text'}}, function (query) {
                    let dev = new devices.CDevice ('', '');
                    dev.setDeviceEx (ECHO_DEVICES + '\\.' + device.serialNumber);
                    dev.setChannel ('Player-Controls');
                    let id = dev.getFullId ('TuneIn');
                    alexa.tuneinSearch (query, function (err, res) {
                        setRequestResult (err, res);
                        if (err || !res || !Array.isArray (res.browseList)) return;
                        let station = res.browseList[0];
                        try {
                            device.setTunein (station.id, station.contentType);
                            devices.root.setAndUpdate (id, {val: station.name, ack: true});
                        } catch (e) {
                        }
                    });
                });
            }
        });

        for (let id of existingIds) {
            dcs.del(id);
        }

        dev.setDevice('history', { common: { name: 'Last detected commands and devices'}});
        devset('#trigger', { val: false, common: { role: 'button', name: 'Trigger/Rescan', desc: 'Set to true, to start a request'}}, function(val) {
            this.updateHistory();
        }.bind(this));
        dev.set('name', { val: '', common: { role: 'text', write: false, name: 'Echo Device name', desc: 'Device name of the last detected command'}});
        let now = new Date(); now = now.getTime() - now.getTimezoneOffset();
        //dev.set('creationTime', alexa.now());
        dev.set('creationTime', { val: now, common: { role: 'value.time'}});
        dev.set('serialNumber', { val: '', common: { role: 'text', write: false}});
        //dev.set('json', { val: {}, common: { write: false}});
        dev.set('summary', { val: '', common: { role: 'text', write: false}});

        devices.update(() => {
            self.updateStates(callback);
        });
    });

};

function main() {

    devices.CDevice.prototype.setf = function (name, obj, func) {
        let st = this.oset(name, obj);
        if (st) st.func = func;
        return st;
    };

    normalizeConfig(adapter.config);

    let options = {
        cookie: adapter.config.cookie,
        password: adapter.config.password,
        email: adapter.config.email,
        bluetooth: true,
        notifications: true,
        userAgent: adapter.config.userAgent,
        acceptLanguage: adapter.config.acceptLanguage,
        amazonPage: adapter.config.cookieLoginUrl,
        logger: adapter.log.debug
    };

    alexa = new Alexa();
    alexa.init(options,
        function (err) {
            if (err) {
                if (err.message === 'no csrf found') {
                    adapter.log.error('Error: no csrf found. Check configuration of email/password or cookie');
                }
                else {
                    adapter.log.error('Error: ' + err.message); // TODO!!
                }
                adapter.getForeignObject("system.adapter." + adapter.namespace, function (err, obj) {
                    if (err || !obj) return;
                    if (!obj.common) obj.common = {};
                    obj.common.enabled = false;
                    adapter.setForeignObject(obj._id, obj, {}, function (err, s_obj) {
                        adapter.log.info("Adapter disabled because of error");
                    });
                });
                return;
            }

            if (options.cookie !== adapter.config.cookie) {
                adapter.log.info('Update cookie in adapter configuration ... restarting ...');
                soef.changeAdapterConfig (adapter, config => {
                     config.cookie = options.cookie;
                });
                return;
            }

            alexa.createStates(function () {
                alexa.createSmarthomeStates(function () {
                    adapter.subscribeStates ('*');
                    adapter.subscribeObjects ('*');
                });
            });
        },
        function(cookie) {
            if (cookie !== adapter.config.cookie) {
                adapter.log.info('Update cookie in adapter configuration ... restarting in 30 seconds ...');
                setTimeout(() => {
                    soef.changeAdapterConfig (adapter, config => {
                         config.cookie = cookie;
                    });
                }, 30000);
            }
        }
    );
}
