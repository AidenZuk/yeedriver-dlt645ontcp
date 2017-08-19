/**
 * Created by zhuqizhong on 17-4-27.
 */

const SendMessage = require('sendmessage');
const event = require('events');
const WorkerBase = require('yeedriver-base/WorkerBase');

const util = require('util');
const net = require('net');
const Q = require('q');
const _ = require('lodash');
const vm = require('vm');
const async = require('async-q');
const ComOverTCP = require("qz-modbus-serial").ComOverTcpPort;


const config = require('../../config.json');
const driver_path = (config.drivers || "").replace("$exec$",process.cwd())+"/".replace(/\/\//g,'/');
const classType = require('./DLT645OnTCPDrivers');

const TAGS = {
    START: 0x68,
    END: 0x16
};
const DL_STATE = {
    WAIT_START: 0,
    GET_ADDRESS: 1,
    WAIT_START2: 2,
    WAIT_CTRL: 3,
    WAIT_LEN: 4,
    GET_DATA: 5,
    WAIT_CS: 6,
    WAIT_END: 7
};





function DLT645(maxSegLength, minGapLength) {
    WorkerBase.call(this, maxSegLength, minGapLength);
}
function convertDevID(devId) {
    devId = ("000000000000" + devId).substr(-12);
    devId = devId.replace(/(.{2})/g, "$1,").split(",")
    delete devId[6];
    for (let i = 0; i <= 5; i++) {
        devId[i] = parseInt(devId[i], 16);
    }
    return devId;
}
util.inherits(DLT645, WorkerBase);
DLT645.prototype.initDriver = function (options, memories) {
    this.rawOptions = options || this.rawOptions;
    this.maxSegLength = options.maxSegLength || this.maxSegLength;
    this.minGapLength = options.minGapLength || this.minGapLength;
    this.inter_device = options.inter_device || this.inter_device;
    this.interval = options.interval || this.interval;
    this.timeout = options.timeout || this.timeout;
    this.devices = this.devices || {};
    _.each(options.sids, function (type, devId) {
        this.devices[convertDevID(devId)] = new classType[type](convertDevID(devId),this);
        //this.devices[convertDevID(devId)].config = options.configs[devId];
    }.bind(this));

    if (options.readConfig) {
        try {
            let script = new vm.Script(" definition = " + options.readConfig);
            let newObj = {};
            script.runInNewContext(newObj);
            this.SetAutoReadConfig(newObj.definition);
        } catch (e) {
            console.error('error in read config:', e.message || e);
        }
     }
    if (!this.inited) {
        this.inited = true;
        //连接设备
        this.mbClient = new ComOverTCP(options.ip + ":" + options.port, {parser: this.parseDLT645Data.bind(this)});
        this.mbClient.open(function (error) {
            if (!error) {

                this.connected = true;
                this.setRunningState(this.RUNNING_STATE.CONNECTED);
            } else {
                console.error('error in open modbus port:', error);
            }
        }.bind(this));


        this.setupAutoPoll();
        // init your device here, don't forget to call this.setupEvent() or this.setupAutoPoll()
    }


};

DLT645.prototype.WriteWQ = function (mapItem, value, devId) {

};
DLT645.prototype.ReadWQ = function (mapItem, _devId) {
    let devId = convertDevID(_devId);
    this.initSTM();

    return this.CreateWQReader(mapItem,  function ( reg) {
        return this.devices[devId] && this.devices[devId].ReadReg(reg);

    }.bind(this))
};
DLT645.prototype.setInOrEx = function (option) {

};
DLT645.prototype.initSTM = function () {
    this.state = DL_STATE.WAIT_START;
    this.cur_pos = 0;
    this.address = [];
    this.data = [];
}
DLT645.prototype.parseDLT645Data = function (data) {

    function processByte(oneByte) {
        switch (this.state) {
            case DL_STATE.WAIT_START:
                if (oneByte === TAGS.START) {
                    this.state = DL_STATE.GET_ADDRESS;
                    this.cur_pos = 0;
                    this.address = [];
                    this.cs_sum = 0x68;
                }
                break;
            case DL_STATE.GET_ADDRESS:
                this.cs_sum += oneByte;
                this.address.push(oneByte);
                this.cur_pos++;
                if (this.cur_pos >= 6) {
                    this.state = DL_STATE.WAIT_START2;
                }
                break;
            case DL_STATE.WAIT_START2:
                this.cs_sum += oneByte;
                if (oneByte === TAGS.START) {
                    this.state = DL_STATE.WAIT_CTRL;
                } else {
                    this.state = DL_STATE.WAIT_START;
                }
                break;
            case DL_STATE.WAIT_CTRL:
                this.cs_sum += oneByte;
                this.ctrlId = oneByte;
                this.state = DL_STATE.WAIT_LEN;
                break;
            case DL_STATE.WAIT_LEN:
                this.cs_sum += oneByte;
                this.data_len = oneByte;
                this.data = [];
                this.cur_pos = 0;
                this.state = DL_STATE.GET_DATA;
                break;
            case DL_STATE.GET_DATA:
                this.cs_sum += (oneByte);
                this.data.push((oneByte - 0x33) & 0xff);
                this.cur_pos++;
                if (this.cur_pos >= this.data_len) {
                    this.state = DL_STATE.WAIT_CS;
                }
                break;
            case DL_STATE.WAIT_CS:
                if (oneByte === (this.cs_sum & 0xFF)) {
                    this.state = DL_STATE.WAIT_END;
                } else {
                    if (oneByte === TAGS.START) {
                        this.state = DL_STATE.GET_ADDRESS;
                    } else {
                        this.state = DL_STATE.WAIT_START;
                    }
                }
                break;
            case DL_STATE.WAIT_END:
                if (oneByte === TAGS.END) {
                    this.emit('newFrame', {ctrlId: this.ctrlId, address: this.address, data: this.data});
                    this.state = DL_STATE.WAIT_START;
                } else {
                    if (oneByte === TAGS.START) {
                        this.state = DL_STATE.GET_ADDRESS;
                    } else {
                        this.state = DL_STATE.WAIT_START;
                    }
                }
                break;
        }
    }

    for (let i = 0; i < data.length; i++) {
        processByte.call(this, data.readUInt8(i));
    }

};


module.exports = new DLT645();