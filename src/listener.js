const {join} = require('path');
const fs = require('fs');
const getBasePath = require('./getBasePath');

module.exports = function listener(config) {
	const basePath = getBasePath(config);
	const route = join(basePath, 'route.json');
	if(!fs.existsSync(route)) {
		fs.writeFileSync(route, '{}');
	}
	return (req, res, next) => {
		const url = req.url;
		if(req.method === "GET" && url.length > 28 && url.indexOf('/.well-known/acme-challenge/') === 0) {
			const token = url.substr(28);
			const {fingerprint, tokens = []} = JSON.parse(fs.readFileSync(route).toString());
			if(tokens.includes(token)) {
				const text = `${token}.${fingerprint}`;
				res.setHeader('Content-Type', 'text/plain; charset=utf-8');
				res.setHeader('Content-Length', text.length);
				return res.end(text);
			}
		}
		next();
	}
};