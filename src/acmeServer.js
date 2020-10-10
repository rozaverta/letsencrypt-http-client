const http = require('http');
const debug = require('debug')('acme');
const listener = require('./listener');

module.exports = async function acmeServer(config) {
	const trigger = listener(config);
	const server = http.createServer((request, response) => {
		trigger(request, response, () => {
			response.statusCode = 404;
			response.end(`Cannot ${request.method} ${request.url}`);
		});
	});
	return new Promise((resolve, reject) => {
		server.listen(80, (err) => {
			if(err) {
				debug('Cannot create http server', err);
				reject(err);
			}
			else {
				resolve(server);
			}
		});
	})
};