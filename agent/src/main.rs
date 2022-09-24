#![deny(rust_2018_idioms)]
#![forbid(unsafe_code)]

use std::{collections::HashSet, sync::Arc, time::Duration};

use axum::{
    http::{self, StatusCode},
    routing::post,
    Extension, Json, Router,
};
use ethers::{signers::Signer, types::Address};
use tokio::sync::mpsc;
use tracing::{error, info};

ethers::contract::abigen!(FaucetV1, "../contracts/abis/FaucetV1.json");

const WEB3_GW_URL: &str = "https://testnet.sapphire.oasis.dev";
const FAUCET_V1_ADDR: &str = "0xd5D44cFdB2040eC9135930Ca75d9707717cafB92";

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt::init();

    let wallet: ethers::signers::LocalWallet = std::env::var("FAUCET_AGENT_PRIVATE_KEY")
        .expect("missing private key")
        .parse()
        .unwrap();
    info!("posting txs as {}", wallet.address());
    let provider =
        ethers::providers::Provider::<ethers::providers::Http>::try_from(WEB3_GW_URL).unwrap();
    let signer = ethers::middleware::SignerMiddleware::new(provider, wallet);
    let faucet = FaucetV1::new(FAUCET_V1_ADDR.parse::<Address>().unwrap(), Arc::new(signer));

    let (req_tx, mut req_rx) = mpsc::unbounded_channel::<Address>();

    tokio::spawn(async move {
        loop {
            let mut reqs: HashSet<Address> = HashSet::new();
            reqs.insert(req_rx.recv().await.expect("disconnected"));
            while let Ok(req) = req_rx.try_recv() {
                reqs.insert(req);
            }
            let num_reqs = reqs.len();
            info!("sending a batch of {num_reqs} requests");
            let contract_call = faucet.payout_batch(reqs.into_iter().collect()).legacy();
            match contract_call.send().await {
                Ok(pending_tx) => {
                    info!("paid out {num_reqs} requests in {}", pending_tx.to_string());
                }
                Err(e) => error!(error=?e, "failed to send tx"),
            }
            tokio::time::sleep(Duration::from_secs(30)).await;
        }
    });

    let app = Router::new()
        .route("/request", post(request_tokens))
        .layer(tower_http::limit::RequestBodyLimitLayer::new(1024))
        .layer(
            tower_http::cors::CorsLayer::new()
                .allow_origin(if cfg!(debug_assertions) {
                    tower_http::cors::AllowOrigin::mirror_request()
                } else {
                    tower_http::cors::AllowOrigin::exact("rose.supply".parse().unwrap())
                })
                .allow_methods([http::Method::GET, http::Method::POST])
                .allow_headers(vec![
                    http::header::CONTENT_TYPE,
                    http::header::AUTHORIZATION,
                ])
                .max_age(std::time::Duration::from_secs(24 * 60 * 60)),
        )
        .layer(tower_http::trace::TraceLayer::new_for_http())
        .route_layer(Extension(req_tx));

    let addr = std::net::SocketAddr::from(([0, 0, 0, 0], 80));
    axum::Server::bind(&addr)
        .serve(app.into_make_service())
        .await
        .unwrap();
}

#[derive(serde::Deserialize)]
struct TokensRequest {
    address: ethers::types::Address,
}

async fn request_tokens(
    Json(req): Json<TokensRequest>,
    Extension(req_tx): Extension<mpsc::UnboundedSender<Address>>,
) -> Result<(), StatusCode> {
    req_tx
        .send(req.address)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(())
}
