const util = require('util');
const EventEmitter = require('events').EventEmitter;
const binding = require('./binding').libueye;
const defines = require('./defines');
const StructType = require('ref-struct');
const ArrayType = require('ref-array')
const ref = require('ref');
const wchar_t = require('ref-wchar');
const co = require('co');

const CameraInfo = StructType({
    dwCameraID: 'uint',
    dwDeviceID: 'uint',
    dwSensorID: 'uint',
    dwInUse: 'uint',
    SerNo: ArrayType('char', 16),
    Model: ArrayType('char', 16),
    dwStatus: 'uint',
    dwReserved: ArrayType('uint', 2),
    fullModelName: ArrayType('char', 32),
    dwReserved2: ArrayType('uint', 5),
});

const statusInfo = {
    [defines.IS_CAP_STATUS_API_NO_DEST_MEM]: 'IS_CAP_STATUS_API_NO_DEST_MEM',
    [defines.IS_CAP_STATUS_API_CONVERSION_FAILED]: 'IS_CAP_STATUS_API_CONVERSION_FAILED',
    [defines.IS_CAP_STATUS_API_IMAGE_LOCKED]: 'IS_CAP_STATUS_API_IMAGE_LOCKED',
    [defines.IS_CAP_STATUS_DRV_OUT_OF_BUFFERS]: 'IS_CAP_STATUS_DRV_OUT_OF_BUFFER',
    [defines.IS_CAP_STATUS_DRV_DEVICE_NOT_READY]: 'IS_CAP_STATUS_API_NO_DEST_MEM',
    [defines.IS_CAP_STATUS_USB_TRANSFER_FAILED]: 'IS_CAP_STATUS_USB_TRANSFER_FAILED',
    [defines.IS_CAP_STATUS_DEV_TIMEOUT]: 'IS_CAP_STATUS_DEV_TIMEOUT',
    [defines.IS_CAP_STATUS_ETH_BUFFER_OVERRUN]: 'IS_CAP_STATUS_ETH_BUFFER_OVERRUN',
    [defines.IS_CAP_STATUS_ETH_MISSED_IMAGES]: 'IS_CAP_STATUS_ETH_MISSED_IMAGES',
    [defines.IS_CAP_STATUS_DEV_MISSED_IMAGES]: 'IS_CAP_STATUS_DEV_MISSED_IMAGES',
    [defines.IS_CAP_STATUS_DEV_FRAME_CAPTURE_FAILED]: 'IS_CAP_STATUS_DEV_FRAME_CAPTURE_FAILED',
};

const CaptureStatus = StructType({
    dwCapStatusCnt_Total: 'uint',
    reserved: ArrayType('byte', 60),
    adwCapStatusCnt_Detail: ArrayType('uint', 256),
});

const SensorInfo = StructType({
    SensorID: 'uint16',
    strSensorName: ArrayType('char', 32),
    nColorMode: 'char',
    nMaxWidth: 'int',
    nMaxHeight: 'int',
    bMasterGain: 'bool',
    bRGain: 'bool',
    bGGain: 'bool',
    bBGain: 'bool',
    bGlobShutter: 'bool',
    wPixelSize: 'uint16',
    nUpperLeftBayerPixel: 'char',
    reserved: ArrayType('char', 13),
});

const ImageFileParams = StructType({
    pwchFileName: ref.refType(ref.types.void), 
    nFileType: 'uint',
    nQuality: 'uint',
    ppcImageMem: ref.refType(ref.types.void),
    pnImageID: ref.refType('uint'),
    reserved: ArrayType('byte', 32),
});

const Size2D = StructType({
    s32Width: 'int',
    s32Height: 'int',
});

const Camera = function (options) {
    const self = this;

    EventEmitter.call(self);

    self.options = options || {};
    self.transactions = [];

    self.def = defines;
    self.binding = binding;

    self.log = {
        info: console.log.bind(console),
        warn: console.log.bind(console),
        debug: console.log.bind(console),
        error: console.log.bind(console),
    };

    self.mem = [];
    self.seqNumId = [];
    self.events = {};
};

util.inherits(Camera, EventEmitter);

module.exports = Camera;

Camera.prototype.nextEvent = function (evt, name) {
    const self = this;

    co (function*() {
        try {
            yield self.waitEvent(evt, 5000);
            self.emit(name);
        } finally { 
            setTimeout(() => {
                self.nextEvent(evt, name);
            }, 100);
        };
    });
};

Camera.prototype.register = function (evt, name) {
    const self = this;

    return new Promise((resolve, reject) => {
        co (function*() {
            yield self.enableEvent(evt);
            resolve();
            self.nextEvent(evt, name);
        });
    });
};

Camera.prototype.init = function () {
    const self = this;

    return new Promise((resolve, reject) => {
        const hCam = ref.alloc('uint', 0);
        return binding.is_InitCamera.async(hCam, ref.NULL, (err, nRet) => {
            if (err || nRet !== defines.IS_SUCCESS) {
                return reject(new Error(`is_InitCamera: ${err || nRet}`));
            }

            self.hCam = hCam.deref();
            return resolve(self.hCam);
        });
    });
};

Camera.prototype.captureStatus = function (cmd) {
    const self = this;

    return new Promise((resolve, reject) => {
        let captureStatus = new CaptureStatus;

        return binding.is_CaptureStatus.async(self.hCam, cmd, captureStatus.ref(), CaptureStatus.size,  (err, nRet) => {
            if (err || nRet !== defines.IS_SUCCESS) {
                return reject(new Error(`is_CaptureStatus: ${err || nRet}`));
            }

            captureStatus = captureStatus.toObject();

            const status = {
                TOTAL: captureStatus.dwCapStatusCnt_Total,
            };

            for(let key = 0; key < captureStatus.adwCapStatusCnt_Detail.length; key++) {
                
                if(captureStatus.adwCapStatusCnt_Detail[key] > 0) {
                    
                    status[statusInfo[key] || key] = captureStatus.adwCapStatusCnt_Detail[key];
                }
            }
        
            return resolve(status);
        }); 
    });
};

Camera.prototype.getNumberOfCameras = function () {
    const self = this;

    return new Promise((resolve, reject) => {
        const count = ref.alloc('uint', 0);

        return binding.is_GetNumberOfCameras.async(count, (err, nRet) => {
            if (err || nRet !== defines.IS_SUCCESS) {
                return reject(new Error(`is_GetNumberOfCameras: ${err || nRet}`));
            }
        
            return resolve(count.deref());
        }); 
    });
};

Camera.prototype.listCameras = function (count) {
    const self = this;

    return new Promise((resolve, reject) => {
        const CameraList = StructType({
            dwCount: 'uint',
            uci: ArrayType(CameraInfo, count),
        });

        const list = new CameraList;

        return binding.is_GetCameraList.async(list.ref(), (err, nRet) => {
            if (err || nRet !== defines.IS_SUCCESS) {
                return reject(new Error(`is_GetCameraList: ${err || nRet}`));
            }

            const res = [];
            const obj = list.toObject();

            for(let i = 0; i < obj.uci.length; i++) {
                const c = obj.uci[i];
                const serNoBuf = new Buffer(c.SerNo);
                const modelBuf = new Buffer(c.Model);
                const fullModelNameBuf = new Buffer(c.fullModelName);

                res.push({
                    cameraID: c.dwCameraID,
                    deviceID: c.dwDeviceID,
                    sensorID: c.dwSensorID,
                    inUse: c.dwInUse,
                    serNo: serNoBuf.toString('UTF8', 0, serNoBuf.indexOf(0)),
                    model: modelBuf.toString('UTF8', 0, modelBuf.indexOf(0)),
                    status: c.dwStatus,
                    fullModelName: fullModelNameBuf.toString('UTF8', 0, fullModelNameBuf.indexOf(0)),
                });
            }
            
            return resolve(res);
        }); 
    });
};

Camera.prototype.getSensorInfo = function () {
    const self = this;

    return new Promise((resolve, reject) => {
        const sensorInfo = new SensorInfo;

        return binding.is_GetSensorInfo.async(self.hCam, sensorInfo.ref(), (err, nRet) => {
            if (err || nRet !== defines.IS_SUCCESS) {
                return reject(new Error(`is_GetSensorInfo: ${err || nRet}`));
            }
        
            return resolve(sensorInfo.toObject());
        }); 
    });
};

Camera.prototype.imageFile = function (options) {
    const self = this;

    return new Promise((resolve, reject) => {
        let wsize;
        if ('win32' == process.platform) {
          wsize = 2;
        } else {
          wsize = 4;
        }

        const size = (options.pwchFileName.length + 1) * wsize;
        let buffer = new Buffer(size);
        const pbuffer = buffer.ref();

        ref.set(pbuffer, 0, options.pwchFileName, wchar_t.string);

        buffer = pbuffer.deref();

        for(let i = buffer.length - wsize; i < buffer.length; i++) {
            buffer[i] = 0;
        }

        options.pwchFileName = buffer;
 
        if(options.sequence) {
            options.ppcImageMem = self.mem[options.sequence].pixels;
            options.pnImageID = self.mem[options.sequence].id;

            const params = new ImageFileParams(options);

            return binding.is_ImageFile.async(self.hCam, defines.IS_IMAGE_FILE_CMD_SAVE, params.ref(), ImageFileParams.size, (err, nRet) => {
                if (err || nRet !== defines.IS_SUCCESS) {
                    return reject(new Error(`is_ImageFile: ${err || nRet}`));
                }

                return resolve();
            });
        } else {
            options.ppcImageMem = options.ppcImageMem;
            options.pnImageID = ref.alloc('uint', options.pnImageID);

            const params = new ImageFileParams(options);

            return binding.is_ImageFile.async(self.hCam, defines.IS_IMAGE_FILE_CMD_SAVE, params.ref(), ImageFileParams.size, (err, nRet) => {
                if (err || nRet !== defines.IS_SUCCESS) {
                    return reject(new Error(`is_ImageFile: ${err || nRet}`));
                }
            
                return resolve();
            }); 
        }
    });
};

Camera.prototype.addToSequence = function (sequence) {
    const self = this;

    return new Promise((resolve, reject) => {
        return binding.is_AddToSequence.async(self.hCam, self.mem[sequence].mem.deref(), self.mem[sequence].id, (err, nRet) => {
            if (err || nRet !== defines.IS_SUCCESS) {
                return reject(new Error(`is_AddToSequence: ${err || nRet}`));
            }

            const seqNum = sequence + 1;
            self.seqNumId[sequence] = seqNum;

            return resolve(seqNum);
        });
    });
};

Camera.prototype.getImageMem = function () {
    const self = this;

    return new Promise((resolve, reject) => {
        const mem = ref.alloc(ref.refType('void'), ref.NULL);

        return binding.is_GetImageMem.async(self.hCam, mem, (err, nRet) => {
            if (err || nRet !== defines.IS_SUCCESS) {
                return reject(new Error(`is_GetImageMem: ${err || nRet}`));
            }

            let sequence = -1;

            self.mem.forEach((m, idx) => {
                if(m.mem.deref().address() === mem.deref().address()) {
                    sequence = idx;
                }
            });

            if (sequence === -1) {
                return reject('is_GetImageMem: sequence not found');
            }

            return resolve(self.mem[sequence]);
        }); 
    });
};

Camera.prototype.freeImageMem = function (sequence) {
    const self = this;

    return new Promise((resolve, reject) => {
        return binding.is_FreeImageMem.async(self.hCam, self.mem[sequence].mem.deref(), self.mem[sequence].id, (err, nRet) => {
            if (err || nRet !== defines.IS_SUCCESS) {
                return reject(new Error(`is_FreeImageMem: ${err || nRet}`));
            }

            return resolve();
        }); 
    });
};

Camera.prototype.setImageMem = function (sequence) {
    const self = this;

    return new Promise((resolve, reject) => {
        return binding.is_SetImageMem.async(self.hCam, self.mem[sequence].mem.deref(), self.mem[sequence].id, (err, nRet) => {
            if (err || nRet !== defines.IS_SUCCESS) {
                return reject(new Error(`is_SetImageMem: ${err || nRet}`));
            }

            return resolve();
        }); 
    });
};

Camera.prototype.lockSeqBuf = function (sequence) {
    const self = this;

    return new Promise((resolve, reject) => {
        return binding.is_LockSeqBuf.async(self.hCam, self.seqNumId[sequence], self.mem[sequence].mem.deref(), (err, nRet) => {
            if (err || nRet !== defines.IS_SUCCESS) {
                return reject(new Error(`is_LockSeqBuf: ${err || nRet}`));
            }

            return resolve();
        }); 
    });
};

Camera.prototype.unlockSeqBuf = function (sequence) {
    const self = this;

    return new Promise((resolve, reject) => {
        return binding.is_UnlockSeqBuf.async(self.hCam, self.seqNumId[sequence], self.mem[sequence].mem.deref(), (err, nRet) => {
            if (err || nRet !== defines.IS_SUCCESS) {
                return reject(new Error(`is_UnlockSeqBuf: ${err || nRet}`));
            }

            return resolve();
        }); 
    });
};

Camera.prototype.allocImageMem = function (imageSize, bitsPerPixel) {
    const self = this;

    return new Promise((resolve, reject) => {
        const mem = ref.alloc(ref.refType('void'), ref.NULL);
        const memId = ref.alloc('uint32', 0);

        return binding.is_AllocImageMem.async(self.hCam, imageSize.s32Width, imageSize.s32Height, bitsPerPixel, mem, memId, (err, nRet) => {
            if (err || nRet !== defines.IS_SUCCESS) {
                return reject(new Error(`is_AllocImageMem: ${err || nRet}`));
            }

            self.mem.push({
                mem: mem,
                pixels: ref.reinterpret(mem.deref(), imageSize.s32Width * imageSize.s32Height * (bitsPerPixel / 8)),
                id: memId.deref(),
            });

            return resolve(self.mem.length-1);
        }); 
    });
};

Camera.prototype.getActSeqBuf = function () {
    const self = this;

    return new Promise((resolve, reject) => {
        const mem = ref.alloc(ref.refType('void'), ref.NULL);
        const memLast = ref.alloc(ref.refType('void'), ref.NULL);
        const memId = ref.alloc('uint32', 0);

        return binding.is_GetActSeqBuf.async(self.hCam, memId, mem, memLast, (err, nRet) => {
            if (err || nRet !== defines.IS_SUCCESS) {
                return reject(new Error(`is_GetActSeqBuf: ${err || nRet}`));
            }

            let sequence = -1;

            self.mem.forEach((m, idx) => {
                if(m.mem.deref().address() === memLast.deref().address()) {
                    sequence = idx;
                }
            });

            if (sequence === -1) {
                return reject('is_GetActSeqBuf: Not found');
            }

            return resolve(sequence);
        });
    });
};

Camera.prototype.nextImage = function (handler, done) {
    const self = this;

    co(function* () {
        yield self.waitEvent(defines.IS_SET_EVENT_FRAME, 5000);

        const mem = ref.alloc(ref.refType('void'), ref.NULL);
        const memLast = ref.alloc(ref.refType('void'), ref.NULL);
        const memId = ref.alloc('uint32', 0);

        binding.is_GetActSeqBuf(self.hCam, memId, mem, memLast);
        let seq = -1;
        self.mem.forEach((m, idx) => {
            if(m.mem.deref().address() === memLast.deref().address()) {
                seq = idx;
            }
        });

        if(seq === -1) {
            return done();
        }

        binding.is_LockSeqBuf(self.hCam, self.seqNumId[seq], self.mem[seq].mem.deref());
 
        return handler({
            pixels: self.mem[seq].pixels,
            sequence: seq,
            id: self.mem[seq].id
        }, () => {
            binding.is_UnlockSeqBuf(self.hCam, self.seqNumId[seq], self.mem[seq].mem.deref());
        
            return done();
        });
    });
};

Camera.prototype.setFrameRate = function (frameRate) {
    const self = this;

    return new Promise((resolve, reject) => {
        const rNewFrameRate = ref.alloc('double', 0);

        return binding.is_SetFrameRate.async(self.hCam, frameRate, rNewFrameRate, (err, nRet) => {
            if (err || nRet !== defines.IS_SUCCESS) {
                return reject(new Error(`is_SetFrameRate: ${err || nRet}`));
            }
        
            return resolve(rNewFrameRate.deref());
        }); 
    });
};

Camera.prototype.setDisplayMode = function (displayMode) {
    const self = this;

    return new Promise((resolve, reject) => {
        return binding.is_SetDisplayMode.async(self.hCam, displayMode, (err, nRet) => {
            if (err || nRet !== defines.IS_SUCCESS) {
                return reject(new Error(`is_SetDisplayMode: ${err || nRet}`));
            }
        
            return resolve();
        }); 
    });
};

Camera.prototype.stopLiveVideo = function (flags) {
    const self = this;

    return new Promise((resolve, reject) => {
        return binding.is_StopLiveVideo.async(self.hCam, flags, (err, nRet) => {
            if (err || nRet !== defines.IS_SUCCESS) {
                return reject(new Error(`is_StopLiveVideo: ${err || nRet}`));
            }
        
            return resolve();
        }); 
    });
};

Camera.prototype.freezeVideo = function (flags) {
    const self = this;

    return new Promise((resolve, reject) => {
        return binding.is_FreezeVideo.async(self.hCam, flags, (err, nRet) => {
            if (err || nRet !== defines.IS_SUCCESS) {
                return reject(new Error(`is_FreezeVideo: ${err || nRet}`));
            }
        
            return resolve();
        }); 
    });
};

Camera.prototype.captureVideo = function (flags) {
    const self = this;

    return new Promise((resolve, reject) => {
        return binding.is_CaptureVideo.async(self.hCam, flags, (err, nRet) => {
            if (err || nRet !== defines.IS_SUCCESS) {
                return reject(new Error(`is_CaptureVideo: ${err || nRet}`));
            }
        
            return resolve();
        }); 
    });
};

Camera.prototype.enableEvent = function (evt) {
    const self = this;

    return new Promise((resolve, reject) => {
        return binding.is_EnableEvent.async(self.hCam, evt, (err, nRet) => {
            if (err || nRet !== defines.IS_SUCCESS) {
                return reject(new Error(`is_EnableEvent: ${err || nRet}`));
            }

            self.events[evt] = true;
        
            return resolve();
        }); 
    });
};

Camera.prototype.disableEvent = function (evt) {
    const self = this;

    return new Promise((resolve, reject) => {
        return binding.is_DisableEvent.async(self.hCam, evt, (err, nRet) => {
            if (err || nRet !== defines.IS_SUCCESS) {
                return reject(new Error(`is_DisableEvent: ${err || nRet}`));
            }

            delete self.events[evt];
        
            return resolve();
        }); 
    });
};

Camera.prototype.waitEvent = function (evt, timeout) {
    const self = this;

    return new Promise((resolve, reject) => {
        return binding.is_WaitEvent.async(self.hCam, evt, timeout, (err, nRet) => {
            if (err || nRet !== defines.IS_SUCCESS) {
                return reject(new Error(`is_WaitEvent: ${err || nRet}`));
            }
        
            return resolve();
        }); 
    });
};

Camera.prototype.setColorMode = function (colorMode) {
    const self = this;

    return new Promise((resolve, reject) => {
        return binding.is_SetColorMode.async(self.hCam, colorMode, (err, nRet) => {
            if (err || nRet !== defines.IS_SUCCESS) {
                return reject(new Error(`is_SetColorMode: ${err || nRet}`));
            }
        
            return resolve();
        }); 
    });
};

Camera.prototype.setAutoParameter = function (cmd, value1, value2) {
    const self = this;

    return new Promise((resolve, reject) => {
        const rValue1 = ref.alloc('double', value1);
        const rValue2 = ref.alloc('double', value2);

        return binding.is_SetAutoParameter.async(self.hCam, cmd, rValue1, rValue2, (err, nRet) => {
            if (err) {
                return reject(new Error(`is_SetAutoParameter: ${err}`));
            }

            return resolve([nRet, rValue1.deref(), rValue2.deref()]);
        });
    });
};

Camera.prototype.setAutoAll = function (cmd, value) {
    const self = this;

    return new Promise((resolve, reject) => {
        co(function*() {
            resolve({
                whiteBalance: yield self.setAutoParameter(defines.IS_SET_ENABLE_AUTO_WHITEBALANCE, value, 0),
                sensorWhiteBalance: yield self.setAutoParameter(defines.IS_SET_ENABLE_AUTO_SENSOR_WHITEBALANCE, value, 0),
                frameRate: yield self.setAutoParameter(defines.IS_SET_ENABLE_AUTO_FRAMERATE, value, 0),
                sensorFrameRate: yield self.setAutoParameter(defines.IS_SET_ENABLE_AUTO_SENSOR_FRAMERATE, value, 0),
                gain: yield self.setAutoParameter(defines.IS_SET_ENABLE_AUTO_GAIN, value, 0),
                sensorGain: yield self.setAutoParameter(defines.IS_SET_ENABLE_AUTO_SENSOR_GAIN, value, 0),
                shutter: yield self.setAutoParameter(defines.IS_SET_ENABLE_AUTO_SHUTTER, value, 0),
                sensorShutter: yield self.setAutoParameter(defines.IS_SET_ENABLE_AUTO_SENSOR_SHUTTER, value, 0),
                sensorGainShutter: yield self.setAutoParameter(defines.IS_SET_ENABLE_AUTO_SENSOR_GAIN_SHUTTER, value, 0),
            });
        });
    }); 
};

Camera.prototype.exposure = function (cmd, type, value) {
    const self = this;

    return new Promise((resolve, reject) => {
        const rValue = type ? ref.alloc(type, value || 0) : ref.NULL;
        const size = type ? ref.coerceType(type).size : 0;

        return binding.is_Exposure.async(self.hCam, cmd, rValue, size, (err, nRet) => {
            if (err || nRet !== defines.IS_SUCCESS) {
                return reject(new Error(`is_Exposure: ${err || nRet}`));
            }

            return resolve(rValue.deref());
        });
    });
};

Camera.prototype.focus = function (cmd, type, value) {
    const self = this;

    return new Promise((resolve, reject) => {
        const rValue = type ? ref.alloc(type, value || 0) : ref.NULL;
        const size = type ? ref.coerceType(type).size : 0;

        return binding.is_Focus.async(self.hCam, cmd, rValue, size, (err, nRet) => {
            if (err || nRet !== defines.IS_SUCCESS) {
                return reject(new Error(`is_Focus: ${err || nRet}`));
            }

            return resolve(rValue.deref()); 
        });
    });
};

Camera.prototype.getArbitraryAOISupported = function () {
    const self = this;

    return new Promise((resolve, reject) => {
        const nAOISupported = ref.alloc('int', 0);

        return binding.is_ImageFormat.async(self.hCam, defines.IMGFRMT_CMD_GET_ARBITRARY_AOI_SUPPORTED,
        nAOISupported,
        ref.sizeof.int,  
        (err, nRet) => {
            if (err || nRet !== defines.IS_SUCCESS) {
                return reject(new Error(`is_ImageFormat: ${err || nRet}`));
            }

            return resolve(nAOISupported.deref() != 0); 
        });
    });
};

Camera.prototype.aoiImageGetSize = function () {
    const self = this;

    return new Promise((resolve, reject) => {
        const imageSize = new Size2D;

        return binding.is_AOI.async(self.hCam, defines.IS_AOI_IMAGE_GET_SIZE,
        imageSize.ref(),
        2 * ref.sizeof.int,  
        (err, nRet) => {
            if (err || nRet !== defines.IS_SUCCESS) {
                return reject(new Error(`is_AOI: ${err || nRet}`));
            }

            return resolve(imageSize.toObject());
        });
    });
};

Camera.prototype.aoiImageSetSize = function (imageSize) {
    const self = this;

    return new Promise((resolve, reject) => {
        const rImageSize = new Size2D(imageSize);

        return binding.is_AOI.async(self.hCam, defines.IS_AOI_IMAGE_SET_SIZE, rImageSize.ref(), 2 * ref.sizeof.int,
        (err, nRet) => {
            if (err || nRet !== defines.IS_SUCCESS) {
                return reject(new Error(`is_AOI: ${err || nRet}`));
            }

            return resolve();
        });
    });
};

Camera.prototype.getMaxImageSize = function* (sensorInfo) {
    const self = this;

    return new Promise((resolve, reject) => {
        co(function*() {
            const aoiSupported = yield self.getArbitraryAOISupported();
            if(aoiSupported) {
                return resolve({
                    s32Width: sensorInfo.nMaxWidth,
                    s32Height: sensorInfo.nMaxHeight,
                }); 
            } else {
                const imageSize = yield self.aoiImageGetSize();
                return resolve({
                    s32Width: imageSize.s32Width,
                    s32Height: imageSize.s32Height,
                });
            }
        });
    }); 
};

Camera.prototype.clearSequence = function () {
    const self = this;

    return new Promise((resolve, reject) => {
        return binding.is_ClearSequence.async(self.hCam, (err, nRet) => {
            if (err || nRet !== defines.IS_SUCCESS) {
                return reject(new Error(`is_ClearSequence: ${err || nRet}`));
            }

            return resolve();
        });
    });
};

Camera.prototype.exit = function () {
    const self = this;

    self.removeAllListeners('frame');

    return new Promise((resolve, reject) => {
        co(function*() {
            const events = Object.keys(self.events);

            for (let i = 0; i < events.length; i++) {
                evt = parseInt(events[i], 10);
                try {
                    yield self.disableEvent(evt);
                } catch (ex) {
                }
            }

            self.events = {};

            try {
                yield self.stopLiveVideo();
            } catch (ex) {
            }

            if (self.mem.length > 0) {
                if (self.seqNumId.length > 0) {
                    try {
                        yield self.clearSequence();
                    } catch (ex) {
                    }
                }
            
                self.seqNumId = [];

                for (let i = 0; i < self.mem.length; i++) {
                    try {
                        yield self.freeImageMem(i);
                    } catch (ex) {
                    }
                }

                self.mem = [];
            }

            return binding.is_ExitCamera.async(self.hCam, (err, nRet) => {
                if (err || nRet !== defines.IS_SUCCESS) {
                    return reject(new Error(`is_ExitCamera: ${err || nRet}`));
                }

                return resolve();
            });
        });
    });
};