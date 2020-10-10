const isObj = (obj) => obj != null && typeof obj === "object" && !Array.isArray(obj);
const domains = (domain) => Array.isArray(domain) ? domain.map(one => String(one)) : [String(domain)];

module.exports = function eachConfig(config, func) {
	if(isObj(config) && config.certificates) {
		config = config.certificates;
	}
	if(isObj(config)) {
		return Object.keys(config).map(key => func(key, domains(config[key])));
	}
	else if(Array.isArray(config)) {
		return config.map(domain => {
			domain = domains(domain);
			return func(domain[0], domain);
		});
	}
	else {
		return [];
	}
};