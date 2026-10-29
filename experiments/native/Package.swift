// swift-tools-version: 5.10
import PackageDescription

let package = Package(
    name: "YomiageMan",
    platforms: [.macOS(.v14), .iOS(.v17)],
    products: [.library(name: "ReaderCore", targets: ["ReaderCore"]),
               .executable(name: "OCRProbe", targets: ["OCRProbe"])],
    targets: [
        .target(name: "ReaderCore"),
        .target(name: "ReaderVision", dependencies: ["ReaderCore"]),
        .executableTarget(name: "OCRProbe", dependencies: ["ReaderVision", "ReaderCore"], path: "Tools/OCRProbe"),
        .testTarget(name: "ReaderCoreTests", dependencies: ["ReaderCore"])
    ]
)
