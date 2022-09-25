# 🌹📦 rose.supply

ROSE Supply is a Mainnet faucet for the Sapphire ParaTime.

Check it out at [https://rose.supply](https://rose.supply).

**This code is not audited. Use at your own risk.**

## Contributing

Contributions are welcome to any component! So far, we have:

* `app` - the very simple frontend of [https://rose.supply](https://rose.supply)
* `agent` - the trusted off-chain relayer that collects requests and sends them to the faucet contract
* `contracts` - the faucet contract(s) that hold all of the ROSE and control how it's released

And, for those curious, the app is hosted on Cloudflare Pages, the agent on a GCP VM, and the faucet on the Sapphire Testnet (Mainnet when launched!). The total hosting cost is zero.
