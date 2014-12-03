(function(window){

  var WORKER_PATH = 'js/recorderWorker.js';
  var encoderWorker = new Worker('js/mp3Worker.js');
  var audio_context, source;

  var __log = function(e, data) {
    log.innerHTML += "\n" + e + " " + (data || '');
  }

  var Recorder = function(cfg){
	var config = cfg || {};
	var bufferLen = config.bufferLen || 4096;
	var self = this;
	var btnRecord = document.createElement('button');
	var btnStop = document.createElement('button');
	if (!config.element) {
		__log('No element specified.  Cannot initialise recorder.');
		return;
	}
	this.outputFormat = config.format || config.element.getAttribute('data-format') || 'wav';
	this.callback = config.callback || config.element.getAttribute('data-callback') || 'console.log';
	this.audioData = null;
	this.context = source.context;
	this.node = (this.context.createScriptProcessor ||
				 this.context.createJavaScriptNode).call(this.context,
														 bufferLen, 2, 2);
	var worker = new Worker(config.workerPath || WORKER_PATH);
	worker.postMessage({
	  command: 'init',
	  config: {
		sampleRate: this.context.sampleRate
	  }
	});
	var recording = false,
	  currCallback;

	this.node.onaudioprocess = function(e){
	  if (!recording) return;
	  worker.postMessage({
		command: 'record',
		buffer: [
		  e.inputBuffer.getChannelData(0),
		  //e.inputBuffer.getChannelData(1)
		]
	  });
	}

	this.configure = function(cfg){
	  for (var prop in cfg){
		if (cfg.hasOwnProperty(prop)){
		  config[prop] = cfg[prop];
		}
	  }
	}

	this.toggleRecording = function() {
		if (recording) {
			return self.stop();
		}
		self.record();
		btnStop.disabled = false;
		config.element.className += ' recording';
		__log('Recording...');
	}

	this.record = function(){
	  recording = true;
	}

	this.stop = function() {
		self.stopRecording();
		btnStop.disabled = true;
		config.element.className = config.element.className.replace(' recording', '');
		__log('Stopped recording.');

		// create WAV download link using audio data blob
		self.exportWAV();

		self.clear();
	}

	this.stopRecording = function(){
	  recording = false;
	}

	this.clear = function(){
	  worker.postMessage({ command: 'clear' });
	}

	this.getBuffer = function(cb) {
	  currCallback = cb || config.callback;
	  worker.postMessage({ command: 'getBuffer' })
	}

	this.exportWAV = function(type){
	  type = type || config.type || 'audio/wav';
	  worker.postMessage({
		command: 'exportWAV',
		type: type
	  });
	}

	worker.onmessage = function(e){
	  var blob = e.data;
	  self.audioData = blob;
	  if (self.outputFormat === 'mp3') {
	  	self.convertToMP3();
	  } else {
	  	// Assume WAV.
	  	window[self.callback](blob);
	  }
	}

	this.convertToMP3 = function() {
	  var arrayBuffer;
	  var fileReader = new FileReader();

	  fileReader.onload = function(){
		arrayBuffer = this.result;
		var buffer = new Uint8Array(arrayBuffer),
		data = parseWav(buffer);

		console.log(data);
		console.log("Converting to Mp3");
		log.innerHTML += "\n" + "Converting to Mp3";

		encoderWorker.postMessage({ cmd: 'init', config:{
			mode : 3,
			channels:1,
			samplerate: data.sampleRate,
			bitrate: data.bitsPerSample
		}});

		encoderWorker.postMessage({ cmd: 'encode', buf: Uint8ArrayToFloat32Array(data.samples) });
		encoderWorker.postMessage({ cmd: 'finish'});
		encoderWorker.onmessage = function(e) {
			if (e.data.cmd == 'data') {

				console.log("Done converting to Mp3");
				log.innerHTML += "\n" + "Done converting to Mp3";

				var mp3Blob = new Blob([new Uint8Array(e.data.buf)], {type: 'audio/mp3'});
				window[self.callback](mp3Blob);

			}
		};
	  };

	  fileReader.readAsArrayBuffer(this.audioData);
	}


	function encode64(buffer) {
		var binary = '',
			bytes = new Uint8Array( buffer ),
			len = bytes.byteLength;

		for (var i = 0; i < len; i++) {
			binary += String.fromCharCode( bytes[ i ] );
		}
		return window.btoa( binary );
	}

	function parseWav(wav) {
		function readInt(i, bytes) {
			var ret = 0,
				shft = 0;

			while (bytes) {
				ret += wav[i] << shft;
				shft += 8;
				i++;
				bytes--;
			}
			return ret;
		}
		if (readInt(20, 2) != 1) throw 'Invalid compression code, not PCM';
		if (readInt(22, 2) != 1) throw 'Invalid number of channels, not 1';
		return {
			sampleRate: readInt(24, 4),
			bitsPerSample: readInt(34, 2),
			samples: wav.subarray(44)
		};
	}

	function Uint8ArrayToFloat32Array(u8a){
		var f32Buffer = new Float32Array(u8a.length);
		for (var i = 0; i < u8a.length; i++) {
			var value = u8a[i<<1] + (u8a[(i<<1)+1]<<8);
			if (value >= 0x8000) value |= ~0x7FFF;
			f32Buffer[i] = value / 0x8000;
		}
		return f32Buffer;
	}

	function uploadAudio(mp3Data){
		var reader = new FileReader();
		reader.onload = function(event){
			var fd = new FormData();
			var mp3Name = encodeURIComponent('audio_recording_' + new Date().getTime() + '.mp3');
			var xhr = new XMLHttpRequest();
			console.log("mp3name = " + mp3Name);
			fd.append('fname', mp3Name);
			fd.append('data', event.target.result);
			xhr.open('POST', 'upload.php', true);
			xhr.onreadystatechange = function() {
				if (xhr.readyState == 4) {
					__log("MP3 Uploaded.");
				}
			};
			xhr.send(fd);
		};
		reader.readAsDataURL(mp3Data);
	}

	source.connect(this.node);
	this.node.connect(this.context.destination);    //this should not be necessary

	// Build interface.
	__log('Building interface...');
	btnRecord.onclick = this.toggleRecording;
	btnRecord.className = 'btn-record'
	btnRecord.innerHTML = 'record';
	btnStop.onclick = this.stop;
	btnStop.className = 'btn-stop';
	btnStop.innerHTML = 'stop';
	btnStop.disabled = true;
	config.element.appendChild(btnRecord);
	config.element.appendChild(btnStop);
	__log('Interface built.');

	return this;
	__log('Recorder initialised.');
  };

	/*Recorder.forceDownload = function(blob, filename){
		console.log("Force download");
		var url = (window.URL || window.webkitURL).createObjectURL(blob);
		var link = window.document.createElement('a');
		link.href = url;
		link.download = filename || 'output.wav';
		var click = document.createEvent("Event");
		click.initEvent("click", true, true);
		link.dispatchEvent(click);
	}*/

	window.Recorder = Recorder;

	var initRecorder = function() {
		try {
			// webkit shim
			window.AudioContext = window.AudioContext || window.webkitAudioContext;
			navigator.getUserMedia = ( navigator.getUserMedia ||
					navigator.webkitGetUserMedia ||
					navigator.mozGetUserMedia ||
					navigator.msGetUserMedia);
			window.URL = window.URL || window.webkitURL;

			audio_context = new AudioContext;
			__log('Audio context set up.');
			__log('navigator.getUserMedia ' + (navigator.getUserMedia ? 'available.' : 'not present!'));
		} catch (e) {
			alert('No web audio support in this browser!');
		}

		navigator.getUserMedia({audio: true}, startUserMedia, function(e) {
			__log('No live audio input: ' + e);
		});
	}

	var startUserMedia = function(stream) {
		var recorders = document.querySelectorAll('.RecordMP3js-recorder');
		source = audio_context.createMediaStreamSource(stream);
		__log('Media stream created.' );
		__log("input sample rate " +source.context.sampleRate);

		for(var i=0; i<recorders.length; i++) {
			recorders[i].recorder = new Recorder({element: recorders[i]});
		}
	}

	if (window.addEventListener) {
		window.addEventListener('load', initRecorder, false);
	} else if (window.attachEvent) {
		window.attachEvent('onload', initRecorder);
	}

})(window);
