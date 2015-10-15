(function(global) {

  var WORKER_PATH;
  var encoderWorker;
  
  var initWorker = function() {
    WORKER_PATH = WORKER_PATH || global.workerPath + 'js/recorderWorker.js';
    try {
      encoderWorker = encoderWorker || new Worker(global.workerPath + 'js/mp3Worker.js');
    } catch (e) {
      console.warn("Web workers are not defined, recording will not work.", e);
    }
  }
  var audio_context, source;

  var __log = function(e, data) {
    var log = document.querySelector("#log");
    if (log && log.length > 0) {
      log = log[0];
      log.innerHTML += "\n" + e + " " + (data || '');
    } else {
      console.log(e, data);
    }
  };

  var Recorder = function(cfg) {
    initWorker();
    var config = cfg || {};
    var bufferLen = config.bufferLen || 4096;
    var self = this;
    var btnPlay = document.createElement('button');
    var btnRecord = document.createElement('button');
    var btnStop = document.createElement('button');
    var btnSave = document.createElement('button');
    if (!config.element) {
      __log('No element specified.  Cannot initialise recorder.');
      return;
    }
    this.element = config.element;
    this.vumeter = null;
    this.outputFormat = config.format || config.element.getAttribute('data-format') || 'wav';
    this.callback = config.callback || config.element.getAttribute('data-callback') || 'console.log';
    this.audioData = null;

    audio_context = global.audio_context;
    source = global.audio_source;

    this.context = source.context;
    this.node = (this.context.createScriptProcessor ||
      this.context.createJavaScriptNode).call(this.context,
      bufferLen, 2, 2);
    this.analyser = this.context.createAnalyser();
    this.analyser.smoothingTimeConstant = 0.3;
    this.analyser.fftSize = 1024;
    this.audio = null;
    this.playing = false;
    var worker = new Worker(config.workerPath || WORKER_PATH);
    worker.postMessage({
      command: 'init',
      config: {
        sampleRate: this.context.sampleRate
      }
    });
    var recording = false,
      currCallback;

    this.node.onaudioprocess = function(e) {
      if (!recording) return;

      worker.postMessage({
        command: 'record',
        buffer: [
          e.inputBuffer.getChannelData(0)
        ]
      });

      // VU Meter.
      var array = new Uint8Array(self.analyser.frequencyBinCount);
      self.analyser.getByteFrequencyData(array);
      var values = 0;

      var length = array.length;
      for (var i = 0; i < length; i++) {
        values += array[i];
      }

      var average = values / length;
      self.vumeter.style.width = Math.min(parseInt(average * 2), 100) + '%';
    };

    this.configure = function(cfg) {
      for (var prop in cfg) {
        if (cfg.hasOwnProperty(prop)) {
          config[prop] = cfg[prop];
        }
      }
    };

    this.toggleRecording = function() {
      if (recording) {
        return self.stop();
      }
      self.record();
      btnStop.disabled = false;
      btnPlay.disabled = true;
      config.element.className += ' recording';
      self.audio = null;
      __log('Recording...');
    };

    this.record = function() {
      recording = true;
    };

    this.stop = function() {
      if (self.playing) {
        self.audio.pause();
        self.audio.currentTime = 0;
        self.playing = false;
        btnPlay.className = 'btn-play';
        btnPlay.innerHTML = '<span class="recorder-icon-play"></span>';
      } else {
        self.stopRecording();
        removeClass(config.element, 'recording');
        __log('Stopped recording.');

        // create WAV download link using audio data blob
        self.exportWAV();

        self.clear();
      }
      btnStop.disabled = true;
      btnRecord.disabled = false;
      btnSave.disabled = false;
    };

    this.stopRecording = function() {
      recording = false;
    };

    this.play = function() {
      if (self.playing) {
        self.audio.pause();
        self.playing = false;
        btnStop.disabled = true;
        btnRecord.disabled = false;
        btnPlay.className = 'btn-play';
        btnPlay.innerHTML = '<span class="recorder-icon-play"></span>';
      } else {
        if (self.audio === null) {
          var reader = new FileReader();
          reader.onload = function(event) {
            self.audio = new Audio(event.target.result);
            self.play();
          };
          reader.readAsDataURL(self.audioData);
        } else {
          self.audio.play();
          self.playing = true;
          btnStop.disabled = false;
          btnRecord.disabled = true;
          btnPlay.className = 'btn-pause';
          btnPlay.innerHTML = '<span class="recorder-icon-pause"></span>';
        }
      }
    };

    this.save = function() {
      btnPlay.disabled = true;
      btnStop.disabled = true;
      btnRecord.disabled = true;
      btnSave.disabled = true;
      config.element.className += ' processing';
      if (self.outputFormat === 'mp3') {
        self.convertToMP3();
      } else {
        // Assume WAV.
        global[self.callback](self, self.audioData, config.element);
      }
    };

    this.clear = function() {
      worker.postMessage({
        command: 'clear'
      });
      initButtons();
      removeClass(config.element, 'recording');
      removeClass(config.element, 'processing');
    };

    this.getBuffer = function(cb) {
      currCallback = cb || config.callback;
      worker.postMessage({
        command: 'getBuffer'
      });
    };

    this.exportWAV = function(type) {
      type = type || config.type || 'audio/wav';
      worker.postMessage({
        command: 'exportWAV',
        type: type
      });
    };

    worker.onmessage = function(e) {
      var blob = e.data;
      self.audioData = blob;
      btnPlay.disabled = false;
    };

    this.convertToMP3 = function() {
      var arrayBuffer;
      var fileReader = new FileReader();

      fileReader.onload = function() {
        arrayBuffer = this.result;
        var buffer = new Uint8Array(arrayBuffer),
          data = parseWav(buffer);

        __log("Converting to Mp3");

        encoderWorker.postMessage({
          cmd: 'init',
          config: {
            mode: 3,
            channels: 1,
            samplerate: data.sampleRate,
            bitrate: data.bitsPerSample
          }
        });

        encoderWorker.postMessage({
          cmd: 'encode',
          buf: Uint8ArrayToFloat32Array(data.samples)
        });
        encoderWorker.postMessage({
          cmd: 'finish'
        });
        encoderWorker.onmessage = function(e) {
          if (e.data.cmd == 'data') {

            __log("Done converting to Mp3");

            var mp3Blob = new Blob([new Uint8Array(e.data.buf)], {
              type: 'audio/mp3'
            });
            global[self.callback](self, mp3Blob, config.element);

          }
        };
      };

      fileReader.readAsArrayBuffer(this.audioData);
    };


    var encode64 = function(buffer) {
      var binary = '',
        bytes = new Uint8Array(buffer),
        len = bytes.byteLength;

      for (var i = 0; i < len; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      return global.btoa(binary);
    };

    var parseWav = function(wav) {
      var readInt = function(i, bytes) {
        var ret = 0,
          shft = 0;

        while (bytes) {
          ret += wav[i] << shft;
          shft += 8;
          i++;
          bytes--;
        }
        return ret;
      };
      if (readInt(20, 2) != 1) throw 'Invalid compression code, not PCM';
      if (readInt(22, 2) != 1) throw 'Invalid number of channels, not 1';
      return {
        sampleRate: readInt(24, 4),
        bitsPerSample: readInt(34, 2),
        samples: wav.subarray(44)
      };
    };

    var Uint8ArrayToFloat32Array = function(u8a) {
      var f32Buffer = new Float32Array(u8a.length);
      for (var i = 0; i < u8a.length; i++) {
        var value = u8a[i << 1] + (u8a[(i << 1) + 1] << 8);
        if (value >= 0x8000) value |= ~0x7FFF;
        f32Buffer[i] = value / 0x8000;
      }
      return f32Buffer;
    };

    var removeClass = function(el, name) {
      el.className = el.className.replace(' ' + name, '');
    };

    var buildInterface = function() {
      __log('Building interface...');
      initButtons();
      config.element.appendChild(btnPlay);
      config.element.appendChild(btnRecord);
      config.element.appendChild(btnStop);
      config.element.appendChild(btnSave);
      self.vumeter = config.element.querySelector('.btn-record .vumeter');
      __log('Interface built.');
    };
    var initButtons = function() {
      btnRecord.onclick = self.toggleRecording;
      btnRecord.className = 'btn-record';
      btnRecord.innerHTML = '<span class="vumeter"></span><span class="recorder-icon-record"></span>';
      btnRecord.disabled = false;
      btnStop.onclick = self.stop;
      btnStop.className = 'btn-stop';
      btnStop.innerHTML = '<span class="recorder-icon-stop"></span>';
      btnStop.disabled = true;
      btnPlay.onclick = self.play;
      btnPlay.className = 'btn-play';
      btnPlay.innerHTML = '<span class="recorder-icon-play"></span>';
      btnPlay.disabled = true;
      btnSave.onclick = self.save;
      btnSave.className = 'btn-save';
      btnSave.innerHTML = '<span class="recorder-icon-upload"></span>';
      btnSave.disabled = true;
    };

    source.connect(this.analyser);
    this.analyser.connect(this.node);
    this.node.connect(this.context.destination);

    buildInterface();

    return this;
    // __log('Recorder initialised.');
  };

  global.Recorder = Recorder;

  var initRecorder = function() {
    if (global.audio_context) {
      console.log("audio_context already ready");
      return;
    }
    try {
      // webkit shim
      global.AudioContext = global.AudioContext || global.webkitAudioContext;
      navigator.getUserMedia = (navigator.getUserMedia ||
        navigator.webkitGetUserMedia ||
        navigator.mozGetUserMedia ||
        navigator.msGetUserMedia);
      global.URL = global.URL || global.webkitURL;

      audio_context = global.audio_context = new global.AudioContext();
      __log('Audio context set up.');
      __log('navigator.getUserMedia ' + (navigator.getUserMedia ? 'available.' : 'not present!'));
    } catch (e) {
      alert('No web audio support in this browser!');
    }

    navigator.getUserMedia({
      audio: true
    }, startUserMedia, function(e) {
      __log('No live audio input: ' + e);
    });
  };

  var startUserMedia = function(stream) {
    if (global.audio_source) {
      console.log("source already ready");
      return;
    }
    source = global.audio_source = audio_context.createMediaStreamSource(stream);
    __log('Media stream created.');
    __log("input sample rate " + source.context.sampleRate);

    var recorders = document.querySelectorAll('.RecordMP3js-recorder');
    for (var i = 0; i < recorders.length; i++) {
      recorders[i].recorder = new Recorder({
        element: recorders[i]
      });
    }
  };

  if (global.addEventListener) {
    global.addEventListener('load', initRecorder, false);
  } else if (global.attachEvent) {
    global.attachEvent('onload', initRecorder);
  } else {
    global.initRecorder = initRecorder;
  }

})(exports || window);
