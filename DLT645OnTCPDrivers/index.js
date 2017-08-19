/**
 * Created by zhuqizhong on 17-5-21.
 */

const util = require('util');
const net = require('net');
const Q = require('q');
const _ = require('lodash');

const async = require('async-q');
const TAGS = {
    START: 0x68,
    END: 0x16
};
/**
 * 各个数据标志
 * @type {{TOTAL_CONSUM: [*]}}
 */
const DATA_TAGS = {
    TOTAL_CONSUM: 0x00010000, //正向有功总电能
    VOLT: 0x0201ff00,   //包括A/B/C三相
    CURRENT: 0x0202ff00, //包括A/B/C三相
    POWER: 0x0203ff00, //有功功率
    Q: 0x0206ff00, //功率因素
    WATER_CONSUM:0x9010
};

/**
 * 数组到实际值的转换
 * @param buffer       待转换的bcd码数据, 低字节在前
 * @param total_len    总共多少字节
 * @param dec_len      倍数
 * @returns {number}
 */
function convertFromBCD(buffer, offset, total_len, dec_len) {
    let multi = 1;
    let total = 0;
    for (let i = 0; i < total_len; i++) {
        let temp = (buffer[offset + i] & 0xF) + (buffer[offset + i] >> 4) * 10;
        total += temp * multi;
        multi *= 100;
    }
    return total / dec_len;
}
class DLTBase {
    constructor(devId, writer) {
        this.devId = devId;
        this.writer = writer;
    }

    /**
     * 生成一个完整的数据帧
     * @param devId  //devId是一个12位长度的字符串
     * @param ctrlId
     * @param data
     */
    createFrame(address, ctrlId, data) {

        let write_buf = [];//[0xFE,0xFE,0xFE,0xFE];
        let cs_sum = TAGS.START;
        write_buf.push(TAGS.START);
        for (let i = 0; i < 6; i++) {
            cs_sum += address[5 - i];
            write_buf.push(address[5 - i]);
        }

        cs_sum += TAGS.START;
        write_buf.push(TAGS.START);

        cs_sum += ctrlId;
        write_buf.push(ctrlId);

        cs_sum += data.length;
        write_buf.push(data.length);

        for (let i = 0; i < data.length; i++) {
            cs_sum += data[i] + 0x33;
            write_buf.push((data[i] + 0x33) & 0xff);
        }
        //write_buf.concat(data);
        write_buf.push(cs_sum & 0xff);
        write_buf.push(TAGS.END);
        return new Buffer(write_buf);
    }

    DoRead(func_code, data_buf) {
        let self = this.writer;

        function DoWrite(data) {
            return Q().then(function () {
                let defer = Q.defer();
                self.once('newFrame', function (data) {
                    defer.resolve(data)
                });
                self.mbClient.write(data);
                return defer.promise;
            }.bind(this)).timeout(2000).catch(function (e) {
                console.error(data_buf.toString(16) + ' error:', e.message || e);
                self.removeAllListeners('newFrame');
                throw e;
            });
        }


        return DoWrite(this.createFrame(this.devId, func_code, data_buf)).then(function (data) {
            return this.ParseRet(data, data_buf);
        }.bind(this))
    }

    ParseRet(data,dataTag){

    }

}
class DTZY1296 extends DLTBase{
    constructor(devId,writer){
        super(devId,writer);
    }

    ReadReg (reg) {
        let data_buf;
        switch (reg) {
            case 1:  //电量
                data_buf =[(DATA_TAGS.TOTAL_CONSUM&0xFF ),(( DATA_TAGS.TOTAL_CONSUM>>8)&0xFF),(( DATA_TAGS.TOTAL_CONSUM>>16)&0xFF),(( DATA_TAGS.TOTAL_CONSUM>>24)&0xFF)];

                break;
            case 2:  //电压
                data_buf =[(DATA_TAGS.VOLT&0xFF ),(( DATA_TAGS.VOLT>>8)&0xFF),(( DATA_TAGS.VOLT>>16)&0xFF),(( DATA_TAGS.VOLT>>24)&0xFF)];
                break;
            case 3: //电流

                data_buf =[(DATA_TAGS.CURRENT&0xFF ),(( DATA_TAGS.CURRENT>>8)&0xFF),(( DATA_TAGS.CURRENT>>16)&0xFF),(( DATA_TAGS.CURRENT>>24)&0xFF)];
                break;
            case 4: //功率

                data_buf =[(DATA_TAGS.POWER&0xFF ),(( DATA_TAGS.POWER>>8)&0xFF),(( DATA_TAGS.POWER>>16)&0xFF),(( DATA_TAGS.POWER>>24)&0xFF)];

                break;
            case 5://功率因素

                data_buf =[(DATA_TAGS.Q&0xFF ),(( DATA_TAGS.Q>>8)&0xFF),(( DATA_TAGS.Q>>16)&0xFF),(( DATA_TAGS.Q>>24)&0xFF)];

                break;
            default:
                return undefined;
                break;
        }
        if(data_buf){
            return this.DoRead(0x11, data_buf);
        }else{
            return Q();
        }
    }

    ParseRet (data, data_tag_buf) {
        let result;
        if (data.ctrlId === 0x91) {
            if (data.data && data.data.length > 4) {
                let data_tag = data.data[0] + (data.data[1] << 8) + (data.data[2] << 16) + (data.data[3] << 24);
                if (_.isEqual(data_tag_buf,data.data.slice(0,4))) {
                    switch (data_tag) {
                        case DATA_TAGS.TOTAL_CONSUM:
                            if (data.data.length >= 8) {
                                result = convertFromBCD(data.data, 4, 4, 100);
                            }
                            break;
                        case DATA_TAGS.VOLT: //电压数据块，每个数2字节
                            if (data.data.length >= 10)
                                result = {
                                    A: convertFromBCD(data.data, 4, 2, 10),
                                    B: convertFromBCD(data.data, 6, 2, 10),
                                    C: convertFromBCD(data.data, 8, 2, 10)
                                };
                            break;
                        case DATA_TAGS.CURRENT:
                            if (data.data.length >= 13)
                                result = {
                                    A: convertFromBCD(data.data, 4, 3, 1000),
                                    B: convertFromBCD(data.data, 7, 3, 1000),
                                    C: convertFromBCD(data.data, 10, 3, 1000)
                                };
                            break;
                        case DATA_TAGS.POWER:
                            if (data.data.length >= 16)
                                result = {
                                    T: convertFromBCD(data.data, 4, 3, 10000),
                                    A: convertFromBCD(data.data, 7, 3, 10000),
                                    B: convertFromBCD(data.data, 10, 3, 10000),
                                    C: convertFromBCD(data.data, 13, 3, 10000)
                                };
                            break;
                        case DATA_TAGS.Q:
                            if (data.data.length >= 12)
                                result = {
                                    T: convertFromBCD(data.data, 4, 2, 1000),
                                    A: convertFromBCD(data.data, 6, 2, 1000),
                                    B: convertFromBCD(data.data, 8, 2, 1000),
                                    C: convertFromBCD(data.data, 10, 2, 1000)
                                };
                            break;
                    }
                }

            }
        }
        return result;

    }
}
class  WM_645 extends DLTBase {
    constructor(devId,writer){
        super(devId,writer);
    }


   ReadReg  (reg) {
        switch (reg) {
            case 1:
                let data_buf =[(DATA_TAGS.WATER_CONSUM & 0xFF ),(( DATA_TAGS.WATER_CONSUM>>8)&0xFF)];
                return this.DoRead(0x01, data_buf, true);
                break;
            default:
                return undefined;
                break;
        }
    };
    ParseRet (data, data_tag_buf) {
        let result;
        if (data.ctrlId === 0x81) {
            if (data.data && data.data.length > 2) {
                let data_tag = data.data[0] + (data.data[1] << 8);
                if (_.isEqual(data.data.slice(0,2), data_tag_buf)) {
                    switch (data_tag) {
                        case DATA_TAGS.WATER_CONSUM:
                            if (data.data.length >= 6) {
                                result = convertFromBCD(data.data, 2, 4, 100);
                            }
                            break;
                    }

                }
            }
        }
        return result;
    }
}

module.exports.WM_645 = WM_645;
module.exports.DTZY1296 = DTZY1296;
