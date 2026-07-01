// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "nyxel-local-bridge",
    platforms: [
        .macOS(.v13),
    ],
    products: [
        .executable(name: "nyxel-local-bridge", targets: ["nyxel-local-bridge"]),
    ],
    targets: [
        .executableTarget(
            name: "nyxel-local-bridge",
            path: "Sources"
        ),
    ]
)
