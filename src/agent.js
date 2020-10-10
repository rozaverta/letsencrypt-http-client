const debug = require('debug')('acme');
const { curly } = require('node-libcurl');
const { HTTP2_HEADER_CONTENT_TYPE, HTTP2_HEADER_CONTENT_LENGTH } = require('http2').constants;

const JSON_TYPE = 'application/json';
const methods = [
	'acl',
	'bind',
	'checkout',
	'connect',
	'copy',
	'delete',
	'get',
	'head',
	'link',
	'lock',
	'm-search',
	'merge',
	'mkactivity',
	'mkcalendar',
	'mkcol',
	'move',
	'notify',
	'options',
	'patch',
	'post',
	'propfind',
	'proppatch',
	'purge',
	'put',
	'rebind',
	'report',
	'search',
	'source',
	'subscribe',
	'trace',
	'unbind',
	'unlink',
	'unlock',
	'unsubscribe',
];
const baseCurlOptions = {};

Object.keys(process.env).forEach(key => {
	if(key.substr(0, 8) === 'CURLOPT_') {
		baseCurlOptions[key.substr(8)] = process.env[key];
	}
});

/**
 * @param url
 * @param options
 * @returns {Promise<{headers: {}, json: boolean, message: string, body: *, version: string, status: number}>}
 */
module.exports = async function agent(url, options = {}) {

	// prepare options
	const {
		json = true,
		payload = null,
		method: methodOption = null,
		headers: headersOption = {},
		timeout = 30,
		sourceIp = null,
	} = options;

	let method = methodOption;
	const header = (name, value) => { headersOption[name] = value; };

	const opt = {
		httpHeader: [],
		CONNECTTIMEOUT: timeout,
		... baseCurlOptions,
	};

	if(payload) {
		if(method == null) {
			method = "post";
		}
		header(HTTP2_HEADER_CONTENT_TYPE, 'application/jose+json');
		opt.postFields = JSON.stringify(payload);
		header(HTTP2_HEADER_CONTENT_LENGTH, opt.postFields.length);
	}

	if(sourceIp) {
		opt.INTERFACE = sourceIp;
	}

	// add headersOption
	const addHeader = (name, value) => {
		opt.httpHeader.push(`${name}: ${String(value).trim()}`)
	};

	Object.keys(headersOption).forEach(name => {
		const val = headersOption[name];
		if(Array.isArray(val)) {
			val.forEach(val => addHeader(name, val))
		}
		else {
			addHeader(name, val)
		}
	});

	// start query
	let res;
	const call = (method || 'get').toLowerCase();

	debug('curl:', call, url);

	if(methods.includes(call)) {
		res = await curly[call](url, opt);
	}
	else {
		res = await curly(url, {
			... opt,
			customRequest: call
		});
	}

	// format result
	const {statusCode, data, headers} = res;

	let version = null;
	let message = 'Http ' + statusCode;

	const responseHeaders = {};
	const parseHeaders = (obj) => {
		for(const name in obj) {
			if(obj.hasOwnProperty(name)) {
				const lower = name.toLowerCase();
				const value = obj[name];
				if(lower === "result") {
					if(value.reason) {
						message = value.reason;
					}
					if(value.version) {
						version = value.version;
					}
				}
				else {
					responseHeaders[lower] = value;
				}
			}
		}
	};

	if(Array.isArray(headers)) {
		headers.forEach(parseHeaders);
	}
	else if(headers != null && typeof headers === "object") {
		parseHeaders(headers);
	}

	// body data
	let body = data;
	let isJson = false;
	const contentType = String(responseHeaders[HTTP2_HEADER_CONTENT_TYPE] || '').toLowerCase().trim();

	if(contentType === JSON_TYPE || contentType.indexOf(JSON_TYPE + ';') === 0) {
		body = JSON.parse(body);
		isJson = true;
	}

	if(json && !isJson) {
		let message = `Invalid server answer <${url}>, expected JSON data`;
		if(res.headers[HTTP2_HEADER_CONTENT_TYPE] === 'application/problem+json') {
			try {
				const body = JSON.parse(res.body);
				if(body && body.detail) {
					message = body.detail;
				}
			}
			catch(e) {}
		}
		throw new Error(message);
	}

	return {
		status: statusCode,
		message,
		version,
		headers: responseHeaders,
		json: isJson,
		body,
	};
};