'use strict';

class ArrayReader {
	constructor(array) {
		this.array = array;
		this.pointer = 0;
	}
	read(length = 1) {
		let slice = this.array.slice(this.pointer, this.pointer + length);
		this.pointer += length;
		return slice;
	}
	readText(length = 1) {
		return Array.prototype.map.call(this.read(length),
			(e) => String.fromCharCode(e)).join('');
	}
	readUBytes(length = 1) {
		return Array.prototype.slice.call(this.read(length));
	}
	readBytes(length = 1) {
		return Array.prototype.map.call(this.read(length),
			(e) => e >= 128 ? e - 256 : e);
	}
	readUShorts(length = 1) {
		let array = this.read(length * 2);
		let result = new Array(length);
		for (let i = 0; i < length; ++i) {
			result[i] = array[i * 2] | array[i * 2 + 1] << 8;
		}
		return result;
	}
	readShorts(length = 1) {
		return this.readUShorts(length).map((e) => e >= 0x8000 ? e - 0x10000 : e);
	}
	readUInts(length = 1) {
		let array = this.read(length * 4);
		let result = new Array(length);
		for (let i = 0; i < length; ++i) {
			let off = i * 4;
			result[i] = array[off] | array[off + 1] << 8
				| array[off + 2] << 16 | array[off + 3] << 24;
		}
		return result;
	}
	readInts(length = 1) {
		return this.readUInts(length).map((e) => e >= 0x80000000 ? e - 0x100000000 : e);
	}
	readChunk() {
		let size = this.readUInts()[0];
		size = (size - 1) >> 2 << 2;
		return this.read(size);
	}
}


class ArrayWriter {
	static BUFFER_SLICE_SIZE = 4096;
	constructor() {
		this.array = new Uint8Array(ArrayWriter.BUFFER_SLICE_SIZE);
		this.pointer = 0;
	}
	expand(length) {
		if (this.pointer + length > this.array.length) {
			length = Math.max(
				Math.ceil(length / ArrayWriter.BUFFER_SLICE_SIZE)
				* ArrayWriter.BUFFER_SLICE_SIZE, ArrayWriter.BUFFER_SLICE_SIZE
			);
			this.array = new Uint8Array([...this.array].concat(new Array(length)));
		}
	}
	writeText(text, length) {
		if (!length) {
			length = text.length + 1;
		}
		let data = new Uint8Array(length);
		for (let i = text.length - 1; i >= 0; --i) {
			data[i] = text.charCodeAt(i);
		}
		return this.writeBytes(data);
	}
	writeBytes(data) {
		let length = data.length;
		this.expand(length);
		let array = new Uint8Array(this.array.buffer, this.pointer, length);
		for (let i = 0; i < length; ++i) {
			array[i] = data[i] & 0xff;
		}
		this.pointer += length;
	}
	writeShorts(data) {
		let length = data.length;
		let buffer = new ArrayBuffer(length * 2);
		let array = new Uint16Array(buffer);
		for (let i = 0; i < length; ++i) {
			array[i] = data[i] & 0xffff;
		}
		this.writeBytes(new Uint8Array(buffer));
	}
	writeInts(data) {
		let length = data.length;
		let buffer = new ArrayBuffer(length * 4);
		let array = new Int32Array(buffer);
		for (let i = 0; i < length; ++i) {
			array[i] = data[i];
		}
		this.writeBytes(new Uint8Array(buffer));
	}
	writeUInts(data) {
		let length = data.length;
		let buffer = new ArrayBuffer(length * 4);
		let array = new Uint32Array(buffer);
		for (let i = 0; i < length; ++i) {
			array[i] = data[i];
		}
		this.writeBytes(new Uint8Array(buffer));
	}
	writeChunk(data) {
		let size = data.length;
		let residue = (-size) & 0x3;
		this.writeUInts([size + 4]);
		this.writeBytes(data);
		this.writeBytes(new Array(residue));
	}
	close() {
		return this.array.slice(0, this.pointer);
	}
}


function fromColor16(colorValue) {
	return [
		(colorValue >> 11 & 0x1F) * 255 / 31,
		(colorValue >> 5 & 0x3F) * 255 / 63,
		(colorValue & 0x1F) * 255 / 31
	];
}
function toColor16(color) {
	return Math.round(color[0] * 31 / 255) << 11
		| Math.round(color[1] * 63 / 255) << 5
		| Math.round(color[2] * 31 / 255);
}

function clamp(value, min, max) {
	return Math.min(max, Math.max(min, value));
}
function mixValue(value0, value1, value) {
	return Math.floor(value0 * (1 - value) + value1 * value);
}
function mixColor(color0, color1, value) {
	return [
		mixValue(color0[0], color1[0], value),
		mixValue(color0[1], color1[1], value),
		mixValue(color0[2], color1[2], value)
	];
}
function getMixValue(value0, value1, value) {
	if (value <= value0) {
		return 0;
	}else if (value >= value1) {
		return 1;
	}
	return (value - value0) / (value1 - value0);
}

function setPixel(data, offset, color, alpha = 255) {
	offset *= 4;
	if (color) {
		data[offset++] = color[0];
		data[offset++] = color[1];
		data[offset++] = color[2];
		data[offset++] = alpha;
	}
}

function readSpriteFile(reader, limit) {
	let fileHeader;
	let format = reader.readText(4);
	if (format !== 'SLDX') {
		alert(MESSAGES[1]);
		return;
	}
	let [version, frameCount] = reader.readUShorts(2);
	let [unknown1, opacity] = reader.readUInts(2);
	currentSprite = null;

	fileHeader = {
		format,
		version,
		frames: frameCount,
		unknown1,
		opacity
	};
	if (frameCount >= 4096) {
		alert(MESSAGES[2]);
		return;
	}
	let frames = new Array(frameCount);
	let previousFrame = null;
	
	if (limit) {
		frameCount = Math.min(frameCount, limit);
	}
	for (let i = 0; i < frameCount; ++i) {
		let [width, height, anchorX, anchorY] = reader.readShorts(4);
		let [frameType, unknown] = reader.readUBytes(2);
		let index = reader.readShorts()[0];
		let frame = {
			width,
			height,
			anchorX,
			anchorY,
			frameType,
			unknown,
			index,
			data: {}
		};
		if (frameType & 0x1) {
			frame.data.normal = createNormalLayer(reader.readChunk(), frame, previousFrame);
		}
		if (frameType & 0x2) {
			frame.data.shadow = createShadowLayer(reader.readChunk(), frame, previousFrame);
		}
		if (frameType & 0x4) {
			frame.data.unknown = reader.readChunk();
		}
		if (frameType & 0x8) {
			frame.data.smudge = createSmudgeLayer(reader.readChunk(), frame, previousFrame);
		}
		if (frameType & 0x10) {
			frame.data.player = createPlayerLayer(reader.readChunk(), frame, previousFrame);
		}
		
		frames[i] = frame;
		previousFrame = frame;

	}
	
	currentSprite = {
		header: fileHeader,
		frames: frames
	}
	
}


function createImage(frame, playerColor, mode) {
	let canvas = document.createElement('canvas');
	let {width, height} = frame;
	let hasSmudge = mode & 0x2;
	let hasPlayer = mode & 0x1;
	let stride = 1 + !!hasSmudge + !!hasPlayer;
	let widthStride = width * stride;
	canvas.width = widthStride;
	canvas.height = height;
	let ctx = canvas.getContext('2d');
	let xOffset = 0;
	if (frame.data.normal) {
		ctx.putImageData(frame.data.normal, 0, 0);
		if (!playerColor) {
			let imageData = ctx.getImageData(0, 0, width, height);
			for (let i = width * height * 4 - 1, data = imageData.data; i >= 0; i -= 4) {
				if (data[i] > 0) {
					data[i] = 255;
				}
			}
			ctx.putImageData(imageData, 0, 0);
		}
	}
	let imageData = ctx.getImageData(0, 0, widthStride, height);
	let data = imageData.data;
	let length = data.length;
	if (frame.data.shadow) {
		let data1 = frame.data.shadow.data;
		for (let j = 0; j < height; ++j) {
			for (let i = 0; i < width; ++i) {
				let alpha = data1[i + j * width];
				if (alpha) {
					let off = (i + j * widthStride) << 2;
					data[off] = 0;
					data[off + 1] = 0;
					data[off + 2] = 0;
					data[off + 3] = alpha;
				}
			}
		}
	}
	if (frame.data.player) {
		let data1 = frame.data.player.data;
		if (hasPlayer) {
			xOffset += width;
			for (let j = 0; j < height; ++j) {
				for (let i = 0; i < width; ++i) {
					let alpha = data1[i + j * width];
					if (alpha) {
						let off = (i + xOffset + j * widthStride) << 2;
						data[off] = 255;
						data[off + 1] = 0;
						data[off + 2] = 0;
						data[off + 3] = alpha;
					}
				}
			}
		}else if (playerColor) { // Tint mode
			for (let j = 0; j < height; ++j) {
				for (let i = 0; i < width; ++i) {
					let off = (i + j * widthStride) << 2;
					let alpha0 = data[off + 3];
					if (alpha0 == NORMAL_COLOR_ALPHA) {
						let alpha = data1[i + j * width];
						if (alpha) {
							let k = alpha / 255;
							let r = data[off], g = data[off + 1], b = data[off + 2];
							let l = .299 * r + .587 * g + .114 * b; // Brightness
							let p = playerColor(l);
							data[off] = mixValue(r, clamp(p[0], 0, 255), k);
							data[off + 1] = mixValue(g, clamp(p[1], 0, 255), k);
							data[off + 2] = mixValue(b, clamp(p[2], 0, 255), k);
							data[off + 3] = 255;
						}
					}
				}
			}
		}
	}
	ctx.putImageData(imageData, 0, 0);
	
	if (hasSmudge && frame.data.smudge) {
		xOffset += width;
		ctx.putImageData(frame.data.smudge, xOffset, 0);
	}
	
	return canvas;
}


function readLayerHeader(reader, hasSize) {
	let coordinates;
	if (hasSize) {
		coordinates = reader.readShorts(4);
	}
	let [flags, unknown] = reader.readUBytes(2);
	let drawCount = reader.readShorts()[0];
	let draws = reader.readUBytes(drawCount * 2);
	return {coordinates, flags, draws, unknown};
}

function createNormalLayer(rawData, frame, previousFrame) {
	let reader = new ArrayReader(rawData);
	let {coordinates, flags, draws} = readLayerHeader(reader, true);
	let {width, height} = frame;
	let imageData = new ImageData(width, height);
	let data = imageData.data;
	let prevoiusData;
	if (flags & 0x80) {
		prevoiusData = previousFrame.data.normal.data;
	}
	let [x0, y0, x1, y1] = coordinates;
	let drawIndex = 0, drawNumber = draws[0], draw = false;
	
	for (let y = y0; y < y1; y += 4) {
		for (let x = x0; x < x1; x += 4) {
			while (--drawNumber < 0) {
				drawNumber = draws[++drawIndex];
				draw = drawIndex % 2;
			}
			if (draw) {
				let colors;
				let [colorValue0, colorValue1] = reader.readUShorts(2);
				let color0 = fromColor16(colorValue0);
				let color1 = fromColor16(colorValue1);
				let indices = reader.readUInts()[0];
				if (colorValue0 > colorValue1) {
					colors = [
						color0, color1,
						mixColor(color0, color1, 1 / 3),
						mixColor(color0, color1, 2 / 3),
					];
				}else{
					colors = [
						color0, color1,
						mixColor(color0, color1, 0.5),
						null
					];
				}
				for (let m = 0; m < 4; ++m) {
					for (let n = 0; n < 4; ++n) {
						let i = m * 4 + n;
						let color = colors[indices >> (i * 2) & 0x3];
						setPixel(data, x + n + (y + m) * width, color, NORMAL_COLOR_ALPHA);
					}
				}
			}else if (prevoiusData) {
				for (let m = 0; m < 4; ++m) {
					let offset = (x + (y + m) * width) << 2;
					for (let n = 0; n < 16; ++n) {
						data[offset] = prevoiusData[offset];
						++offset;
					}
				}
			}
		}
	}
	imageData.coordinates = coordinates;
	
	return imageData;

}

function createShadowLayer(rawData, frame, previousFrame) {
	let reader = new ArrayReader(rawData);
	let {coordinates, flags, draws} = readLayerHeader(reader, true);
	let {width, height} = frame;
	let imageData = {
		data: new Uint8Array(width * height),
		width, height
	};
	let data = imageData.data;
	let prevoiusData;
	if (flags & 0x80) {
		prevoiusData = previousFrame.data.shadow.data;
	}
	let [x0, y0, x1, y1] = coordinates;
	let drawIndex = 0, drawNumber = draws[0], draw = false;
	
	for (let y = y0; y < y1; y += 4) {
		for (let x = x0; x < x1; x += 4) {
			while (--drawNumber < 0) {
				drawNumber = draws[++drawIndex];
				draw = drawIndex % 2;
			}
			if (draw) {
				let colors;
				let [color0, color1] = reader.readUBytes(2);
				let indices = reader.readUBytes(6);
				if (color0 > color1) {
					colors = [
						color0, color1,
						mixValue(color0, color1, 1 / 7),
						mixValue(color0, color1, 2 / 7),
						mixValue(color0, color1, 3 / 7),
						mixValue(color0, color1, 4 / 7),
						mixValue(color0, color1, 5 / 7),
						mixValue(color0, color1, 6 / 7)
					];
				}else{
					colors = [
						color0, color1,
						mixValue(color0, color1, 1 / 5),
						mixValue(color0, color1, 2 / 5),
						mixValue(color0, color1, 3 / 5),
						mixValue(color0, color1, 4 / 5),
						null,
						255
					];
				}

				for (let m = 0; m < 4; ++m) {
					for (let n = 0; n < 4; ++n) {
						let i = m * 4 + n;
						let vi = Math.floor(i * 3 / 8);
						let ri = i * 3 % 8;
						let color = colors[
							(indices[vi] | indices[vi + 1] << 8) >> ri & 0x7
						];
						data[x + n + (y + m) * width] = color;
					}
				}
				
			}else if (prevoiusData) {
				for (let m = 0; m < 4; ++m) {
					let offset = x + (y + m) * width;
					for (let n = 0; n < 4; ++n) {
						data[offset] = prevoiusData[offset];
						++offset;
					}
				}
			}
		}
	}
	imageData.coordinates = coordinates;
	return imageData;
}

function createSmudgeLayer(rawData, frame, previousFrame) {
	let reader = new ArrayReader(rawData);
	let {flags, draws} = readLayerHeader(reader, false);
	let coordinates = frame.data.normal.coordinates;
	let {width, height} = frame;
	let imageData = new ImageData(width, height);
	let data = imageData.data;
	let prevoiusData;
	if (flags & 0x80) {
		prevoiusData = previousFrame.data.normal.data;
	}
	let [x0, y0, x1, y1] = coordinates;
	let drawIndex = 0, drawNumber = draws[0], draw = false;
	
	for (let y = y0; y < y1; y += 4) {
		for (let x = x0; x < x1; x += 4) {
			while (--drawNumber < 0) {
				drawNumber = draws[++drawIndex];
				draw = drawIndex % 2;
			}
			if (draw) {
				let colors;
				let [colorValue0, colorValue1] = reader.readUShorts(2);
				let color0 = fromColor16(colorValue0);
				let color1 = fromColor16(colorValue1);
				let indices = reader.readUInts()[0];
				if (colorValue0 > colorValue1) {
					colors = [
						color0, color1,
						mixColor(color0, color1, 1 / 3),
						mixColor(color0, color1, 2 / 3),
					];
				}else{
					colors = [
						color0, color1,
						mixColor(color0, color1, 0.5),
						null
					];
				}
				for (let m = 0; m < 4; ++m) {
					for (let n = 0; n < 4; ++n) {
						let i = m * 4 + n;
						let color = colors[indices >> (i * 2) & 0x3];
						setPixel(data, x + n + (y + m) * width, color);
					}
				}
			}else if (prevoiusData) {
				for (let m = 0; m < 4; ++m) {
					let offset = (x + (y + m) * width) << 2;
					for (let n = 0; n < 16; ++n) {
						data[offset] = prevoiusData[offset];
						++offset;
					}
				}
			}
		}
	}
	imageData.coordinates = coordinates;
	
	return imageData;

}

function createPlayerLayer(rawData, frame, previousFrame) {
	let reader = new ArrayReader(rawData);
	let {flags, draws} = readLayerHeader(reader, false);
	let coordinates = frame.data.normal.coordinates;
	let {width, height} = frame;
	let imageData = {
		data: new Uint8Array(width * height),
		width, height
	};
	let data = imageData.data;
	let prevoiusData;
	if (flags & 0x80 && previousFrame) {
		prevoiusData = previousFrame.data.player.data;
	}
	let [x0, y0, x1, y1] = coordinates;
	let drawIndex = 0, drawNumber = draws[0], draw = false;
	
	for (let y = y0; y < y1; y += 4) {
		for (let x = x0; x < x1; x += 4) {
			while (--drawNumber < 0) {
				drawNumber = draws[++drawIndex];
				draw = drawIndex % 2;
			}
			if (draw) {
				let colors;
				let [color0, color1] = reader.readUBytes(2);
				let indices = reader.readUBytes(6);
				if (color0 > color1) {
					colors = [
						color0, color1,
						mixValue(color0, color1, 1 / 7),
						mixValue(color0, color1, 2 / 7),
						mixValue(color0, color1, 3 / 7),
						mixValue(color0, color1, 4 / 7),
						mixValue(color0, color1, 5 / 7),
						mixValue(color0, color1, 6 / 7)
					];
				}else{
					colors = [
						color0, color1,
						mixValue(color0, color1, 1 / 5),
						mixValue(color0, color1, 2 / 5),
						mixValue(color0, color1, 3 / 5),
						mixValue(color0, color1, 4 / 5),
						null,
						255
					];
				}

				for (let m = 0; m < 4; ++m) {
					for (let n = 0; n < 4; ++n) {
						let i = m * 4 + n;
						let vi = Math.floor(i * 3 / 8);
						let ri = i * 3 % 8;
						let color = colors[
							(indices[vi] | indices[vi + 1] << 8) >> ri & 0x7
						];
						if (color) {
							data[x + n + (y + m) * width] = color;
						}
					}
				}
				
			}else if (prevoiusData) {
				for (let m = 0; m < 4; ++m) {
					let offset = x + (y + m) * width;
					for (let n = 0; n < 4; ++n) {
						data[offset] = prevoiusData[offset];
						++offset;
					}
				}
			}
		}
	}
	imageData.coordinates = coordinates;
	
	return imageData;
}


function writeFile(sprite) {
	let writer = new ArrayWriter();
	
	let frameCount = sprite.frames.length;
	let fileHeader = sprite.header;
	writer.writeText(fileHeader.format, 4);
	writer.writeShorts([fileHeader.version, frameCount]);
	writer.writeUInts([fileHeader.unknown1, fileHeader.opacity]);
	
	let previousFrame = null;
	for (let i = 0; i < frameCount; ++i) {
		let frame = sprite.frames[i];
		writer.writeShorts([frame.width, frame.height, frame.anchorX, frame.anchorY]);
		
		frame.data.unknown = compileUnknown(frame.data.normal);
		
		let frameType = 0;
		if (frame.data.normal) {
			frameType |= 0x1;
		}
		if (frame.data.shadow) {
			frameType |= 0x2;
		}
		if (frame.data.unknown) {
			frameType |= 0x4;
		}
		if (frame.data.smudge) {
			frameType |= 0x8;
		}
		if (frame.data.player) {
			frameType |= 0x10;
		}
		frameType |= frame.unknown << 8; // unknown = 128 means not always on top
		
		writer.writeShorts([frameType, i]);
		
		if (frameType & 0x1) {
			writer.writeChunk(compileRGB(frame.data.normal));
		}
		if (frameType & 0x2) {
			writer.writeChunk(compileMono(frame.data.shadow));
		}
		if (frameType & 0x4) {
			writer.writeChunk(frame.data.unknown); // CURSOR CLICK MASK?
		}
		if (frameType & 0x8) {
			writer.writeChunk(compileRGB(frame.data.smudge, false));
		}
		if (frameType & 0x10) {
			writer.writeChunk(compileMono(frame.data.player, false));
		}
		
		previousFrame = frame;

	}
	
	return writer.close();
}

function writeLayerHeader(writer, coordinates, flags, draws, tiles) {
	if (coordinates) {
		writer.writeShorts(coordinates);
	}
	writer.writeBytes([flags, 1]);
	writer.writeShorts([draws.length / 2]);
	writer.writeBytes(draws);
	let length = tiles.length;
	for (let i = 0; i < length; ++i) {
		writer.writeShorts(tiles[i]);
	}
}

function compileRGB(imageData, hasCoordinates = true) {
	let writer = new ArrayWriter();
	let stride = imageData.width;
	let [x0, y0, x1, y1] = imageData.coordinates;
	let width = x1 - x0, height = y1 - y0;
	let rows = height >> 2, columns = width >> 2;
	let tileCount = rows * columns;
	let draws = [];
	let tiles = new Array(tileCount);
	let tileIndex = 0;
	let currentIsEmpty = true;
	let draw = 0;
	let data = imageData.data;
	
	for (let ind = 0; ind < tileCount; ++ind) {
		let column = ind % columns, row = Math.floor(ind / columns);
		let x = column * 4 + x0, y = row * 4 + y0;
		let isEmpty = true;
		let containEmpty = false;
		
		for (let i = 0; i < 16; ++i) {
			let off = ((y + Math.floor(i / 4)) * stride + (x + i % 4)) << 2;
			if (data[off + 3] !== 0) {
				isEmpty = false;
			}else{
				containEmpty = true;
			}
		}
		
		if (!isEmpty) {
			let colors = new Array(16);
			let brights = new Array(16);
			for (let i = 0; i < 16; ++i) {
				let off = ((y + Math.floor(i / 4)) * stride + (x + i % 4)) << 2;
				if (data[off + 3]) {
					let r = data[off], g = data[off + 1], b = data[off + 2];
					colors[i] = [r, g, b];
					brights[i] = .299 * r + .587 * g + .114 * b;
				}
			}
			
			let minBr = Infinity, maxBr = -Infinity;
			let color0, color1;
			for (let j = 0; j < 16; ++j) {
				if (colors[j]) {
					let b = brights[j];
					if (b < minBr) {
						minBr = b; color0 = colors[j];
					}
					if (b > maxBr) {
						maxBr = b; color1 = colors[j];
					}
				}
			}
			let colorValue0 = toColor16(color0);
			let colorValue1 = toColor16(color1);
			if (colorValue1 == colorValue0) {
				containEmpty = true;
			}
			if ((colorValue1 >= colorValue0) ^ containEmpty) {
				[color0, color1] = [color1, color0];
				[colorValue0, colorValue1] = [colorValue1, colorValue0];
			}
			
			let palette;
			if (colorValue1 == colorValue0) {
				palette = [color0];
			}else if (containEmpty) {
				palette = [
					color0, color1, 
					mixColor(color0, color1, 1 / 2)
				];
			}else{
				palette = [
					color0, color1,
					mixColor(color0, color1, 1 / 3),
					mixColor(color0, color1, 2 / 3)
				];
			}
			let plen = palette.length;
			
			let cids = new Array(16);
			
			for (let j = 0; j < 16; ++j) {
				let c0 = colors[j];
				if (!c0) {
					cids[j] = 3;
				}else{
					let ik = 0;
					if (plen > 1) {
						let d = Infinity;
						for (let k = 0; k < plen; ++k) {
							let c = palette[k];
							let dx = c[0] - c0[0], dy = c[1] - c0[1], dz = c[2] - c0[2];
							let d1 = dx * dx + dy * dy + dz * dz;
							if (d1 < d) {
								d = d1; ik = k;
							}
						}
					}
					cids[j] = ik;
				}
			}
			
			let tile = [
				colorValue0, colorValue1,
				cids[0] | cids[1] << 2 | cids[2] << 4 | cids[3] << 6 | cids[4] << 8 | cids[5] << 10 | cids[6] << 12 | cids[7] << 14,
				cids[8] | cids[9] << 2 | cids[10] << 4 | cids[11] << 6 | cids[12] << 8 | cids[13] << 10 | cids[14] << 12 | cids[15] << 14
			];
			
			tiles[tileIndex++] = tile;
		}
		
		if (isEmpty == currentIsEmpty) {
			if (draw < 255) {
				++draw;
			}else{
				draws.push(draw, 0);
				draw = 1;
			}
		}else{
			draws.push(draw);
			currentIsEmpty = !currentIsEmpty;
			draw = 1;
		}
	}
	
	if (draw) {
		draws.push(draw);
	}
	if (draws.length % 2) {
		draws.push(0);
	}
	
	tiles = tiles.slice(0, tileIndex);
	
	writeLayerHeader(writer, hasCoordinates && imageData.coordinates, 0, draws, tiles);
	return writer.close();
}

const COMPILE_MONO_MAP_MODE0 = [0, 2, 3, 4, 5, 6, 7, 1];
const COMPILE_MONO_MAP_MODE1 = [0, 2, 3, 4, 5, 1, 6, 7];
function compileMono(imageData, hasCoordinates = true) {
	let writer = new ArrayWriter();
	let stride = imageData.width;
	let [x0, y0, x1, y1] = imageData.coordinates;
	let width = x1 - x0, height = y1 - y0;
	let rows = height >> 2, columns = width >> 2;
	let tileCount = rows * columns;
	let draws = [];
	let tiles = new Array(tileCount);
	let tileIndex = 0;
	let currentIsEmpty = true;
	let draw = 0;
	let data = imageData.data;
	
	let brights = new Array(16);
	for (let ind = 0; ind < tileCount; ++ind) {
		let column = ind % columns, row = Math.floor(ind / columns);
		let x = column * 4 + x0, y = row * 4 + y0;
		let isEmpty = true;
		let containEmpty = false;
		
		for (let i = 0; i < 16; ++i) {
			let off = (y + Math.floor(i / 4)) * stride + (x + i % 4);
			let c = data[off];
			brights[i] = c;
			if (c) {
				isEmpty = false;
			}else{
				containEmpty = true;
			}
		}
		
		if (!isEmpty) {
			let bright0 = Infinity, bright1 = 0;
			let map;
			if (containEmpty) {
				map = COMPILE_MONO_MAP_MODE1;
				for (let j = 0; j < 16; ++j) {
					let b = brights[j];
					if (b < bright0 && b > 0) {
						bright0 = b;
					}
					if (b > bright1 && b < 255) {
						bright1 = b;
					}
				}
				if (!bright1) { // Only 0 and 255
					bright0 = 0;
				}
			}else{
				map = COMPILE_MONO_MAP_MODE0;
				for (let j = 0; j < 16; ++j) {
					let b = brights[j];
					if (b < bright0) {
						bright0 = b;
					}
					if (b > bright1) {
						bright1 = b;
					}
				}
				[bright0, bright1] = [bright1, bright0];
			}
			
			let db = bright1 - bright0 || 1;
			let cids = new Array(16);
			
			if (containEmpty) {
				for (let j = 0; j < 16; ++j) {
					let c = brights[j];
					if (c == 0) {
						cids[j] = 6;
					}else if (c == 255) {
						cids[j] = 7;
					}else{
						cids[j] = map[Math.round((c - bright0) * 5 / db)];
					}
				}
			}else{
				for (let j = 0; j < 16; ++j) {
					let c = brights[j];
					cids[j] = map[Math.round((c - bright0) * 7 / db)];
				}
			}
			
			let tile = [
				bright0 | bright1 << 8,
				(cids[0] | cids[1] << 3 | cids[2] << 6 | cids[3] << 9 | cids[4] << 12 | cids[5] << 15) & 0xffff,
				(cids[5] >> 1 | cids[6] << 2 | cids[7] << 5 | cids[8] << 8 | cids[9] << 11 | cids[10] << 14) & 0xffff,
				(cids[10] >> 2 | cids[11] << 1 | cids[12] << 4 | cids[13] << 7 | cids[14] << 10 | cids[15] << 13) & 0xffff
			];
			
			tiles[tileIndex++] = tile;
		}
		
		if (isEmpty == currentIsEmpty) {
			if (draw < 255) {
				++draw;
			}else{
				draws.push(draw, 0);
				draw = 1;
			}
		}else{
			draws.push(draw);
			currentIsEmpty = !currentIsEmpty;
			draw = 1;
		}
	}
	
	if (draw) {
		draws.push(draw);
	}
	if (draws.length % 2) {
		draws.push(0);
	}
	
	tiles = tiles.slice(0, tileIndex);
	
	writeLayerHeader(writer, hasCoordinates && imageData.coordinates, 1, draws, tiles);
	return writer.close();
}


function compileUnknown(imageData) {
	let data = imageData.data;
	let [x0, y0, x1, y1] = imageData.coordinates;
	let rows = (y1 - y0) / 4;
	let columns = (x1 - x0) / 4;
	let stride = imageData.width;
	
	let segs = [];
	for (let p = 0; p < rows; ++p) {
		let seg = [];
		let yt = p * 4 + y0;
		
		let subseg = [];
		let rep = 0;
		let lastTile = 0;
		
		for (let i = 0; i < columns; ++i) {
			let tile = 0;
			let xt = i * 4 + x0;
			for (let j = 0; j < 16; ++j) {
				let x = xt + j % 4, y = yt + Math.floor(j / 4);
				let c = data[(x + y * stride) * 4 + 3];
				if (c) {
					tile |= 1 << j;
				}
			}
			if (tile == lastTile) {
				if  (subseg.length) {
					let slen = subseg.length;
					seg.push(slen + 128);
					for (let i = 0; i < slen; ++i) {
						let tile = subseg[i];
						seg.push(tile % 256, Math.floor(tile / 256));
					}
					subseg = [];
				}
				++rep;
			}else {
				if (rep) {
					while(rep > 128) {
						seg.push(127);
						rep -= 127;
					}
					if (rep == 128) {
						seg.push(126, 2);
					}else {
						seg.push(rep);
					}
					rep = 0;
				}
				subseg.push(tile);
				if  (subseg.length >= 127) {
					let slen = subseg.length;
					seg.push(slen + 128);
					for (let i = 0; i < slen; ++i) {
						let tile = subseg[i];
						seg.push(tile % 256, Math.floor(tile / 256));
					}
					subseg = [];
				}
			}
			
			lastTile = tile;
		}
		if  (subseg.length) {
			let slen = subseg.length;
			seg.push(slen + 128);
			for (let i = 0; i < slen; ++i) {
				let tile = subseg[i];
				seg.push(tile % 256, Math.floor(tile / 256));
			}
			subseg = [];
		}else if (rep) {
			while(rep > 128) {
				seg.push(127);
				rep -= 127;
			}
			if (rep == 128) {
				seg.push(126, 2);
			}else {
				seg.push(rep);
			}
			rep = 0;
		}
		
		segs.push(seg);
	}
	
	let offsets = [0, 0];
	for (let i = 1, s = 0; i < rows; ++i) {
		s += segs[i - 1].length;
		offsets.push(s % 256, Math.floor(s / 256));
	}
	
	let result = [5, 0].concat(offsets).concat(segs.flat());
	return result;
	
}