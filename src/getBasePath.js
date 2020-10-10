const fs = require('fs');

module.exports = function getBasePath(config) {
	let basePath = null;
	if(typeof config === "string") {
		basePath = config;
	}
	else if(config != null && config.hasOwnProperty('basePath')) {
		basePath = config.basePath;
	}

	if(!basePath) {
		throw new Error("acme base path not defined");
	}

	if(!fs.existsSync(basePath)) {
		throw new Error("acme base path not exists");
	}

	return basePath;
};