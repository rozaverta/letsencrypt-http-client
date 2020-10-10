const RSA = require('rsa-compat').RSA;

async function generateRSAKeyPair(config = {}) {
	const options = {
		bitlen: config.keyBits || 2048,
		exp: 65537,
		public: true,
		pem: true,
		internal: true
	};
	return new Promise((resolve, reject) => {
		RSA.generateKeypair(options, function (err, keypair) {
			if(err) {
				reject(err);
			}
			else {
				resolve(keypair);
			}
		});
	});
}

function toAgreement(links) {
	const match = /.*<(.*)>;rel="terms-of-service".*/.exec(links);
	return (Array.isArray(match) ? {agreement: match[1]} : {})
}

module.exports = {
	generateRSAKeyPair,
	toAgreement,
};