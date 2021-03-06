const EventEmitter = require('events').EventEmitter;
const RSA = require('rsa-compat').RSA;
const debug = require('debug')('acme');
const forge = require('node-forge');
const FData = require('./FData');
const {generateRSAKeyPair, toAgreement} = require('./helper');
const agent = require('./agent');

async function promise(client, func, errorEvent = 'error', completeEvent = null) {
	try {
		const result = await func.call(client);
		if(completeEvent) {
			client.emit(completeEvent, result);
		}
		return result;
	}
	catch(err) {
		client.emit(errorEvent, err);
		throw err;
	}
}

class Client extends EventEmitter {

	/**
	 * @type {{agreement: String, key: *, url: String}}
	 * @private
	 */
	_account;

	/**
	 * @var {Object}
	 * @private
	 */
	_directories = {};

	/**
	 * @var array
	 * @private
	 */
	_config;

	/**
	 * Client constructor.
	 *
	 * config.mode The mode for ACME (production / staging)
	 * config.basePath The base path for the filesystem (used to store account information and csr / keys
	 * config.username The acme username
	 * config.sourceIp The source IP for Guzzle (via curl.options) to bind to (defaults to 0.0.0.0 [OS default])
	 *
	 * @param {{
	 *     captureRejections?: boolean,
	 *     mode?: String,
	 *     basePath?: String,
	 *     username?: String,
	 *     sourceIp?: String,
	 * }} config
	 * 
	 */
	constructor(config = {}) {
		super(typeof config.captureRejections === "boolean" ? {captureRejections: config.captureRejections} : {});
		this._config = config;
	}

	/**
	 * Initialize the client
	 */
	async init() {
		if(this._account) {
			return;
		}
		const initialize = async () => {
			if (this._option('username', false) === false) {
				throw new Error('Username not provided');
			}
			//Load the directories from the LE api and load/create account
			const {body} = await this._req(this._url('directory'));
			this._directories = body;
			this._account = await this._getAccount();
			this._loadEvents();
			return this._account;
		};
		await promise(this, initialize, 'error', 'init');
	}

	/**
	 * Check certificate is expired
	 *
	 * @param {String} key
	 * @returns {Boolean}
	 */
	isExpired(key) {
		const diffDays = (certExpiration, now) => (
			Math.round(Math.abs((certExpiration.getTime() - now.getTime()) / (24 * 60 * 60 * 1000)))
		);

		const certInValid = (cert, date) => (
			(cert.notBefore > date > cert.notAfter || diffDays(new Date(cert.validity.notAfter), date) < 30)
		);

		const fd = this._fData();
		if(!fd.domain(key).exists('cert.pem')) {
			debug(`Certificate with key ${key} is missing, going to regenerate.`);
			return true;
		}

		try {
			const text = fd.read('cert.pem');
			const cert = forge.pki.certificateFromPem(text);
			return certInValid(cert, new Date());
		}
		catch(err) {
			this.emit('error', err);
			throw err;
		}
	}

	async generateCertificate(certificate) {
		if(!this._account) {
			const err = new Error('Client is not initialized.');
			this.emit('error', err);
			throw err;
		}

		const generate = async () => {
			const fd = this._fData();
			const {key, domains} = certificate;
			const account = this._account;
			const payload = {
				"identifiers": domains.map(domain => ({type: "dns", value: domain}))
			};

			const url = this._url('newOrder');
			debug(`Submitting new order to ${url} for ${JSON.stringify(domains)}`);

			// load authorizations URL
			const {body: {authorizations, finalize/*, ...order*/}} = await this._signedRequest(url, payload, account.key, account.url);
			const fingerprint = RSA.thumbprint(account.key);
			const tokens = [];
			const auth = [];

			for(let i = 0; i < authorizations.length; i++) {
				const {body: {identifier, status, expires, challenges}} = await this._signedRequest(authorizations[i], null, account.key, account.url);
				const challenge = challenges.find(item => item.type === "http-01");

				// http challenge authorization
				auth.push({
					authorizationUrl: authorizations[i],
					identifier,
					status,
					expires,
					challenge,
					wellKnownUrl: `http://${identifier.value}/.well-known/acme-challenge/${challenge.token}`,
					keyAuthorization: `${challenge.token}.${fingerprint}`,
				});

				tokens.push(challenge.token);
			}

			fd.domain(null).write('route.json', {fingerprint, tokens}, 'json');

			// try local http connect and validate
			for(let i = 0; i < auth.length; i++) {
				const {challenge, wellKnownUrl, keyAuthorization} = auth[i];
				const {status: httpStatus, body} = await this._req(wellKnownUrl, {json: false});
				if(httpStatus !== 200 || body !== keyAuthorization) {
					throw new Error(`Could not verify ownership via local HTTP`);
				}

				let maxAttempts = this._option('maxAttempts', 15),
					attempts = maxAttempts,
					valid = false;

				do {
					debug('try verify', attempts - maxAttempts + 1, challenge.url);
					const {body} = await this._signedRequest(challenge.url, {resource: 'challenge', keyAuthorization}, account.key, account.url);
					valid = body.status === 'valid';
					if(valid) {
						break;
					}
					await this.sleep(Math.ceil(attempts / maxAttempts));
					maxAttempts--;
				} while (maxAttempts > 0);

				if(!valid) {
					throw new Error('Could not verify ownership via HTTP');
				}
			}

			// create certificate
			const domainKeypair = await generateRSAKeyPair(this._config);
			const csr = RSA.generateCsrDerWeb64(domainKeypair, domains);

			debug('Requesting certificate.');
			const {body} = await this._signedRequest(finalize, {csr}, account.key, account.url);
			const {body: cert} = await this._signedRequest(body.certificate, null, account.key, account.url, false);

			// write certificate
			const data = {
				key,
				domains,
				keypair: domainKeypair,
				cert,
			};

			fd.domain(key).write('cert.json', data, 'json');
			fd.write('cert.key', domainKeypair.privateKeyPem);
			fd.write('cert.pem', cert);

			const crt = String(cert).match(/-+BEGIN CERTIFICATE-+(.+?)-+END CERTIFICATE-+\n+-+BEGIN CERTIFICATE-+(.+?)-+END CERTIFICATE-/s);
			const lne = w => `-----${w} CERTIFICATE-----`;
			if(crt) {
				fd.write('cert.crt', `${lne('BEGIN')}${crt[1]}${lne('END')}\n`);
				fd.write('cert.ca',  `${lne('BEGIN')}${crt[2]}${lne('END')}\n`);
			}

			this.clear();

			return data;
		};

		await promise(this, generate, 'cert-error', 'cert-update');
	}

	async sleep(second) {
		return new Promise(resolve => {
			setTimeout(resolve, second * 1000);
		});
	}

	clear() {
		this._fData().write('route.json', '{}');
	}

	/**
	 * @returns {Promise<String>}
	 * @private
	 */
	async _nonce() {
		const res = await this._req(this._url('newNonce'), {
			method: 'head',
			json: false
		});
		if(res.headers['replay-nonce']) {
			return res.headers['replay-nonce'];
		}
		else {
			debug(`Error getting nonce`);
			throw new Error(`Error getting nonce`);
		}
	}

	/**
	 * @param {String} url
	 * @param {Object} options
	 * @returns {Promise<{headers: {}, json: boolean, message: string, body: *, version: string, status: number}>}
	 * @private
	 */
	async _req(url, options = {}) {

		const sourceIp = this._option('sourceIp');
		if(sourceIp != null) {
			options.sourceIp = sourceIp;
		}

		const timeout = this._option('connectionTimeout');
		if(timeout != null) {
			options.timeout = timeout;
		}

		return await agent(url, options);
	}

	/**
	 * Load the keys in memory
	 *
	 * @returns {Promise<{agreement: String, key: *, url: String}>}
	 * @throws {Error}
	 * @private
	 */
	async _getAccount() {
		const fd = this._fData();
		if(fd.domain(null).exists('account.json')) {
			return require(fd.path('account.json'));
		}
		else {
			// create account
			const keypair = await generateRSAKeyPair(this._config);
			const payload = {
				"termsOfServiceAgreed": true,
				"contact": [
					`mailto:${this._option('username')}`
				]
			};
			const url = this._url('newAccount');
			debug(`Creating new account with url ${url}`);

			const {headers} = await this._signedRequest(url, payload, keypair);
			const account = {
				key: keypair,
				url: headers['location'],
				agreement: toAgreement(headers['link']).agreement,
			};
			fd.write('account.json', account, 'json');
			return account;
		}
	}

	/**
	 * @param {String} url
	 * @param {Object|null} payload
	 * @param {Object} keypair
	 * @param {String|null} kid
	 * @param {boolean} json
	 * @returns {Promise<{headers: {}, json: boolean, message: string, body: *, version: string, status: number}>}
	 * @private
	 */
	async _signedRequest(url, payload, keypair, kid = null, json = true) {
		const nonce = await this._nonce();
		const kp = RSA.import(keypair);
		const header = {alg: "RS256", jwk: RSA.exportPublicJwk(kp)};
		const jwsPayload = RSA.signJws(
			keypair,
			undefined,
			Object.assign(kid ? {kid, alg: header.alg} : header, {nonce, url}),
			payload == null ? '' : Buffer.from(JSON.stringify(payload))
		);
		return await this._req(url, {payload: jwsPayload, json});
	}

	/**
	 * Get a defined option
	 *
	 * @param {String} key
	 * @param def
	 * @return {*}
	 * @private
	 */
	_option(key, def = null) {
		if (this._config.hasOwnProperty(key)) {
			return this._config[key];
		}
		return def;
	}

	/**
	 * Get the LE directory path
	 *
	 * @param {String} directory
	 * @return {String}
	 * @throws {Error}
	 * @private
	 */
	_url(directory) {
		if(directory === 'directory') {
			return String(this._option('directoryUrl', 'https://acme-v02.api.letsencrypt.org')).replace(/\/$/, '') + '/directory';
		}
		if(this._directories[directory]) {
			return this._directories[directory];
		}
		throw new Error(`Invalid directory: ${directory} not listed`);
	}

	/**
	 * Create new FData object
	 *
	 * @returns {FData}
	 * @private
	 */
	_fData() {
		return new FData(this._config);
	}

	/**
	 * Load events
	 * @private
	 */
	_loadEvents() {
		const events = this._option('events', {});
		const add = (name, listener) => {
			if(typeof listener === "function") {
				this.on(name, listener);
			}
		};
		if(events != null && typeof events === "object") {
			Object.keys(events).forEach(event => {
				const listener = events[event];
				if(Array.isArray(listener)) {
					listener.forEach(one => add(event, one));
				}
				else {
					add(event, listener);
				}
			});
		}
	}
}

module.exports = Client;