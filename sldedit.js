'use strict';
const NORMAL_COLOR_ALPHA = 224;
const MAX_CANVAS_SIZE = 32500;

const COLOR_FUNCTION_MAP = {
	blue:   function(l) { l *= 1.8; return [l - 384, l - 255, l]; },
	red:    function(l) { l *= 1.8; return [l, l - 255, l - 255]; },
	green:  function(l) { l *= 1.44;return [l - 255, l, l - 255]; },
	yellow: function(l) { l *= 1.5; return [l, l, l - 255]; },
	cyan:   function(l) { l *= 1.5; return [l - 255, l, l]; },
	purple: function(l) { l *= 1.6; return [l, l - 255, l]; },
	gray:   function(l) {           return [l, l, l]; },
	orange: function(l) { l *= 1.8; return [l, l * .5, l - 255]; },
	
	brown:  function(l) { return [l, l * .75, l * .5]; },
	white:  function(l) { l = Math.sqrt(l / 255) * 320; return [l, l, l]; },
	black:  function(l) { l = l * l / 320; return [l, l, l]; }
}

var currentSprite;
var selectedIndices = [];
var fileName = null;

function loadSpriteFile(file) {
	if (file) {
		setLoadingStatus(true);
		document.getElementById('downloadBtn').disabled = true;
		fileName = file.name;
		let time = Date.now();
		let fr = new FileReader();
		fr.onload = function() {
			readSpriteFile(new ArrayReader(new Uint8Array(fr.result)));
			document.getElementById('downloadBtn').disabled = false;
			setLoadingStatus(false);
			document.getElementById('loadTime').innerHTML = ((Date.now() - time) / 1000).toFixed(2) + 's';
			
			let header = currentSprite.header;
			document.getElementById('frameCountLabel').innerHTML = header.frames;
			document.getElementById('opacityLabel').value = header.opacity;
			reloadFrameImages();
		}
		fr.readAsArrayBuffer(file);
	}
}

window.onload = function() {
	document.body.ondrop = function(e) {
		e.preventDefault();
		let files = e.dataTransfer.files;
		if (files && files[0]) {
			if (files[0].name.toLowerCase().endsWith('.sld')) {
				loadSpriteFile(files[0]);
			}else{
				loadImageFile(files[0]);
			}
		}
	}
	document.body.ondragover = function(e) {
		e.preventDefault();
	}
	document.body.ondragenter = function(e) {
		e.preventDefault();
	}
	document.body.ondragleave = function(e) {
		e.preventDefault();
	}
	
	let playerColor = document.querySelector('#playerColor');
	playerColor.onchange = function(){
		this.style.backgroundColor = this.value;
	}
	for (let i = playerColor.children.length - 1; i >= 0; --i) {
		let option = playerColor.children[i];
		option.style.backgroundColor = option.value;
	}
	playerColor.onchange();
	
	document.querySelector('#reloadFrameImages').onclick = function() {
		if (currentSprite) {
			setLoadingStatus(true);
			setTimeout(function() {
				reloadFrameImages();
				setLoadingStatus(false);
			}, 1);
		}
	}
	
	document.querySelector('#opacityLabel').onchange = function() {
		if (currentSprite) {
			currentSprite.header.opacity = +this.value;
		}
	}
	
	document.querySelector('#toggleLayerModeBtn').onclick = function() {
		if (currentSprite && selectedIndices.length) {
			selectedIndices.forEach((i) => {
				let frame = currentSprite.frames[i];
				if (frame) {
					frame.unknown ^= 0x80;
					let li = frame.canvas.parentElement;
					if (frame.unknown & 0x80) {
						li.classList.add('overlay');
					}else {
						li.classList.remove('overlay');
					}
				}
			});
		}
	}
	
	document.querySelector('#setAnchorBtn').onclick = function() {
		if (currentSprite && selectedIndices.length) {
			let frame = currentSprite.frames[selectedIndices[0]];
			let v = prompt(MESSAGES[4], frame.anchorX + ',' + frame.anchorY).split(/[ \,]+/);
			let x = +v[0] || 0, y = +v[1] || 0;
			selectedIndices.forEach((i) => {
				let frame = currentSprite.frames[i];
				if (frame) {
					frame.anchorX = x;
					frame.anchorY = y;
				}
			});
		}
	}
	
	document.querySelector('#removeBtn').onclick = function() {
		if (currentSprite && selectedIndices.length) {
			selectedIndices.sort((a, b) => a - b);
			for (let i = selectedIndices.length - 1; i >= 0; --i) {
				//console.log(currentSprite.frames.length, selectedIndices[i]);
				let frame = currentSprite.frames.splice(selectedIndices[i], 1)[0];
				if (frame) {
					let li = frame.canvas.parentElement;
					li.parentElement.removeChild(li);
				}
			}
			selectedIndices.length = 0;
		}
	}
	
	document.querySelector('#selectAllBtn').onclick = function() {
		if (currentSprite) {
			if (selectedIndices.length) {
				selectedIndices.length = 0;
				let lis = document.querySelectorAll('.result li.selected');
				for (let i = lis.length - 1; i >= 0; --i) {
					lis[i].classList.remove('selected');
				}
			}else{
				let lis = document.querySelectorAll('.result li');
				for (let i = lis.length - 1; i >= 0; --i) {
					lis[i].classList.add('selected');
					selectedIndices[i] = i;
				}
			}
			
		}
	}

}


function reloadFrameImages() {
	let resultElement = document.querySelector('.result');
	resultElement.innerHTML = '';
	let strideMode = document.getElementById('strideMode').value;
	let playerColor = document.getElementById('includePlayerCheck').checked
		&& COLOR_FUNCTION_MAP[document.getElementById('playerColor').value];
	
	let frameCount = currentSprite.frames.length;
	for (let i = 0; i < frameCount; ++i) {
		let frame = currentSprite.frames[i];
		let canvas = createImage(frame, playerColor, strideMode);
		canvas.title = '#' + i + ', ' + frame.width + 'x' + frame.height;
		let li = document.createElement('li');
		li.appendChild(canvas);
		resultElement.appendChild(li);
		frame.canvas = canvas;
		if (frame.unknown & 0x80) {
			li.className = 'overlay';
		}
		li.onclick = function() {
			let i = currentSprite.frames.indexOf(frame);
			let index = selectedIndices.indexOf(i);
			if (index >= 0) {
				selectedIndices.splice(index, 1);
				li.classList.remove('selected');
			}else {
				selectedIndices.push(i);
				li.classList.add('selected');
			}
			let toolbarElement = document.querySelector('.toolbar');
			if (selectedIndices.length) {
				toolbarElement.style.display = '';
			}else {
				toolbarElement.style.display = 'none';
			}
		}
	}
}


var previousBlobURL = null;
function downloadImages() {
	let frames = currentSprite.frames;
	let frameCount = frames.length;
	
	let rows = +document.getElementById('outputRows').value;
	let columns = +document.getElementById('outputColumns').value;
	
	let itemsPerPage = rows * columns;
	let pageCount = Math.ceil(frameCount / itemsPerPage);
	let numLength = pageCount.toString().length;
	let numPrefix = '0'.repeat(numLength);
	
	setLoadingStatus(true);
	setTimeout(function(){
		let zip = new JSZip();
		let imageFilePrefix = 'image_' + rows + 'x' + columns + '_';
		for (let i = 0; i < pageCount; ++i) {
			let frameIndexOffset = i * itemsPerPage;
			let gridSize = [0, 0];
			let itemCount = Math.min(itemsPerPage, frameCount - frameIndexOffset);
			for (let j = 0; j < itemCount; ++j) {
				let frame = frames[j + frameIndexOffset];
				gridSize[0] = Math.max(frame.canvas.width, gridSize[0]);
				gridSize[1] = Math.max(frame.canvas.height, gridSize[1]);
			}
			
			let csv = [];
			let canvas = document.createElement('canvas');
			canvas.width = gridSize[0] * columns;
			canvas.height = gridSize[1] * rows;
			if (canvas.width > MAX_CANVAS_SIZE || canvas.height > MAX_CANVAS_SIZE) {
				alert(MESSAGES[3].replace('%d', MAX_CANVAS_SIZE));
			}
			let context = canvas.getContext('2d');
			for (let j = 0; j < itemCount; ++j) {
				let frame = frames[j + frameIndexOffset];
				let fCanvas = frame.canvas;
				let fImageData = fCanvas.getContext('2d').getImageData(0, 0, fCanvas.width, fCanvas.height);
				let x0 = (j % columns) * gridSize[0], y0 = Math.floor(j / columns) * gridSize[1];
				context.putImageData(fImageData, x0, y0);
				csv.push(frame.anchorX + ',' + frame.anchorY);
			}
			
			let url = canvas.toDataURL();
			let imageName = imageFilePrefix + (numPrefix + i).slice(-numLength) + '.png';
			zip.file(imageName, url.slice(url.indexOf(',') + 1), {base64: true});
			zip.file(imageName + '.csv', csv.join('\n'));
			
		}
		setTimeout(function(){
			setLoadingStatus(false);
			if (previousBlobURL) {
				URL.revokeObjectURL(previousBlobURL);
			}
			zip.generateAsync({type:"blob"}).then(function(content) {
				let a = document.createElement('a');
				previousBlobURL = URL.createObjectURL(content);
				a.href = previousBlobURL;
				a.download = fileName + '.zip';
				a.click();
			});
		}, 1);
	}, 1);
}

function downloadSprite() {
	let tempBuffer = writeFile(currentSprite);
	saveFile(tempBuffer, {
		suggestedName: fileName + '.sld',
		types: [{
			description: 'SLD Files',
			accept: {
				'application/octet-stream': ['.sld'],
			}
		}]
	});
}

function setOutputGridSizeAutomatic() {
	let frames = currentSprite.frames;
	let frameCount = frames.length;
	
	let maxWidth = 0, maxHeight = 0;
	for (let i = frameCount - 1; i >= 0; --i) {
		let frame = frames[i];
		maxWidth = Math.max(frame.canvas.width, maxWidth);
		maxHeight = Math.max(frame.canvas.height, maxHeight);
	}
	let rows = Math.max(1, Math.floor(MAX_CANVAS_SIZE / maxWidth));
	let columns = Math.max(1, Math.floor(MAX_CANVAS_SIZE / maxHeight));
	
	if (rows * columns > frameCount) {
		let maxRows = rows;
		let d = Infinity;
		let currentColumns = columns;
		for (; columns >= 1; --columns) {
			rows = Math.ceil(frameCount / columns);
			let d1 = columns * rows - frameCount + Math.abs(rows - columns) * 0.001;
			if (d1 < d) {
				d = d1;
				currentColumns = columns;
			}
		}
		columns = currentColumns;
		rows = Math.ceil(frameCount / columns);
	}
	
	document.getElementById('outputRows').value = rows;
	document.getElementById('outputColumns').value = columns;
}

function setLoadingStatus(status) {
	document.querySelector('.loading').style.display = status ? 'initial' : '';
}

function testLoad() {
	setLoadingStatus(true);
	setTimeout(function(){
		let tempBuffer = writeFile(currentSprite);
		readSpriteFile(new ArrayReader(tempBuffer));
		setTimeout(function(){
			setLoadingStatus(false);
		}, 10);
	}, 10);
}


function loadImageFile(file) {
	if (file) {
		setLoadingStatus(true);
		document.getElementById('downloadBtn2').disabled = true;
		fileName = file.name;
		let time = Date.now();
		let fr = new FileReader();

		let rows = +document.getElementById('outputRows').value;
		let columns = +document.getElementById('outputColumns').value;
		let frameCount = columns * rows;
		let strideMode = document.getElementById('strideMode').value;
		let stride = 1 + Boolean(strideMode & 0x1) + Boolean(strideMode & 0x2);
		let frames = [];
		let overlayPlayer = strideMode & 0x40;
		
		fr.onload = function() {
			let image = new Image();
			image.onload = function() {
				let canvas = document.createElement('canvas');
				let sliceStride = image.naturalWidth / columns;
				let sliceWidth = sliceStride / stride;
				let sliceHeight = image.naturalHeight / rows;
				let frameWidth = Math.ceil(sliceWidth / 4) * 4;
				let frameHeight = Math.ceil(sliceHeight / 4) * 4;
				canvas.width = frameWidth;
				canvas.height = frameHeight;
				let ctx = canvas.getContext('2d');
				
				let frameSize = frameWidth * frameHeight;
				for (let i = 0; i < frameCount; ++i) {
					let x = i % columns * sliceStride;
					let y = Math.floor(i / columns) * sliceHeight;
					ctx.clearRect(0, 0, sliceWidth, sliceHeight);
					ctx.drawImage(image, 
						x, y, sliceWidth, sliceHeight,
						0, 0, sliceWidth, sliceHeight);
						
					
					let shadowData, playerData, smudgeData;
					let normalData = ctx.getImageData(0, 0, frameWidth, frameHeight);
					normalData.coordinates = [0, 0, frameWidth, frameHeight];
					let shadowImageData = new Uint8Array(frameWidth * frameHeight);
					let overlayPlayerData = new Uint8Array(frameWidth * frameHeight);
					let hasShadow = false;
					for (let i = 0, data = normalData.data; i < frameSize; ++i) {
						let off = (i << 2) + 3;
						if (data[off] < 144) {
							shadowImageData[i] = data[off];
							data[off] = 0;
							hasShadow = true;
						}else if (overlayPlayer && data[off] == 255) {
							let r = data[off - 3];
							let g = data[off - 2];
							let b = data[off - 1];
							let l = (.299 * r + .587 * g + .114 * b + Math.max(r, g, b)) / 2; // Brightness
							let s = (Math.max(r, g, b) - Math.min(r, g, b));
							overlayPlayerData[i] = s;
							data[off - 3] = l;
							data[off - 2] = l;
							data[off - 1] = l;
							data[off] = 255;
						}
					}
					if (hasShadow) {
						shadowData = {
							width: frameWidth,
							height: frameHeight,
							coordinates: normalData.coordinates,
							data: shadowImageData
						};
					}
					if (overlayPlayer) {
						playerData = {
							width: frameWidth,
							height: frameHeight,
							coordinates: normalData.coordinates,
							data: overlayPlayerData
						};
					}
					
					if (strideMode & 0x1) {
						x += sliceWidth;
						ctx.clearRect(0, 0, sliceWidth, sliceHeight);
						ctx.drawImage(image, 
							x, y, sliceWidth, sliceHeight,
							0, 0, sliceWidth, sliceHeight);
						let imageData = ctx.getImageData(0, 0, frameWidth, frameHeight);
						let playerImageData = new Uint8Array(frameWidth * frameHeight);
						for (let i = 0, data = imageData.data; i < frameSize; ++i) {
							let off = (i << 2) + 3;
							playerImageData[i] = data[off];
						}
						playerData = {
							width: frameWidth,
							height: frameHeight,
							coordinates: normalData.coordinates,
							data: playerImageData
						};
					}else if (strideMode & 0x40) {
						let playerImageData = new Uint8Array(frameWidth * frameHeight);
						for (let i = 0, data = normalData.data; i < frameSize; ++i) {
							let off = (i << 2) + 3;
							if (data[off] == 255) {
								playerImageData[i] = 255;
							}
						}
						playerData = {
							width: frameWidth,
							height: frameHeight,
							coordinates: normalData.coordinates,
							data: playerImageData
						};
					}
					
					if (strideMode & 0x2) {
						x += sliceWidth;
						ctx.clearRect(0, 0, sliceWidth, sliceHeight);
						ctx.drawImage(image, 
							x, y, sliceWidth, sliceHeight,
							0, 0, sliceWidth, sliceHeight);
						smudgeData = ctx.getImageData(0, 0, frameWidth, frameHeight);
						smudgeData.coordinates = [0, 0, frameWidth, frameHeight];
					}
					
					
					let frameType = 0x1 | (shadowData && 0x2) | (smudgeData && 0x8) | (playerData && 0x10);
					
					frames.push({
						anchorX: Math.floor(frameWidth / 2),
						anchorY: Math.floor(frameHeight / 2),
						width: frameWidth,
						height: frameHeight,
						index: 0,
						unknown: 0,
						frameType: frameType,
						data: {
							normal: normalData,
							shadow: shadowData,
							smudge: smudgeData,
							player: playerData
						}
					});
				}
				
				currentSprite = {
					header: {
						format: "SLDX",
						frames: 1,
						opacity: 255,
						version: 4,
						unknown1: 1048576
					},
					frames: frames
				};
				
				document.getElementById('downloadBtn2').disabled = false;
				setLoadingStatus(false);
				reloadFrameImages();
				document.getElementById('loadTime').innerHTML = ((Date.now() - time) / 1000).toFixed(2) + 's';
			};
			image.src = fr.result;
		}
		fr.readAsDataURL(file);
	}
}


function saveFile(content, options) {
	if (typeof showSaveFilePicker !== 'undefined') {
		try {
		showSaveFilePicker(options).then(function(handle) {
			return handle.createWritable();
		}).then(function(writable) {
			return writable.write(content).then(function() {
				writable.close();
			});
		});
		} catch (error) {
			console.log(error);
		}
	}else{
		if (previousBlobURL) {
			URL.revokeObjectURL(previousBlobURL);
		}
		let a = document.createElement('a');
		previousBlobURL = URL.createObjectURL(new Blob([content]));
		a.href = previousBlobURL;
		a.download = options.suggestedName;
		a.click();
	}
}
