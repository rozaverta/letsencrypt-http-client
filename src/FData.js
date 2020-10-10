const {join} = require('path');
const fs = require('fs');
const getBasePath = require('./getBasePath');

class FData {
	_basePath;
	_domain = null;

	constructor(config) {
		this._basePath = getBasePath(config);
	}

	domain(value) {
		if(value == null || value === '') {
			this._domain = null;
		}
		else {
			this._domain = value;
			const path = join(this._basePath, value);
			if(!fs.existsSync(path)) {
				fs.mkdirSync(path);
			}
		}
		return this;
	}

	path(path = null) {
		let basePath = this._basePath;
		if(this._domain != null) {
			basePath = join(basePath, this._domain);
		}
		return path == null ? basePath : join(basePath, path);
	}

	exists(path) {
		return fs.existsSync(this.path(path));
	}

	read(path) {
		return fs.readFileSync(this.path(path));
	}

	write(path, data, format = 'text') {
		format = format == null ? 'text' : String(format).toLowerCase();
		if(format === 'json') {
			data = JSON.stringify(data);
		}
		else if(format !== 'text') {
			throw new Error(`Invalid data format <${format}>`)
		}
		fs.writeFileSync(this.path(path), data);
	}
}

module.exports = FData;