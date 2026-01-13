#!/bin/bash
#
# run-winforms.sh - Run Windows Forms .NET applications on Linux using Wine
#
# Usage: ./run-winforms.sh [build|run|setup|clean]
#   build  - Build the project (default if exe doesn't exist)
#   run    - Run the application (builds first if needed)
#   setup  - Install Wine and .NET runtime only
#   clean  - Remove build artifacts
#
# This script can be copied to other Windows Forms projects and will work
# as long as there's a .csproj or .sln file in the directory.
#

set -e

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WINEPREFIX="${WINEPREFIX:-$HOME/.wine-dotnet}"
DOTNET_CHANNEL="8.0"

# Microsoft's official releases metadata
RELEASES_JSON_URL="https://dotnetcli.blob.core.windows.net/dotnet/release-metadata/${DOTNET_CHANNEL}/releases.json"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Minimum Wine version required for .NET 8
MIN_WINE_VERSION=8

# Check if Wine is installed and version is sufficient
check_wine() {
    if command -v wine &> /dev/null; then
        local wine_ver=$(wine --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+' | head -1)
        local wine_major=$(echo "$wine_ver" | cut -d. -f1)

        if [ "$wine_major" -lt "$MIN_WINE_VERSION" ] 2>/dev/null; then
            log_warn "Wine $wine_ver is installed, but .NET 8 requires Wine $MIN_WINE_VERSION.0+"
            return 1
        fi

        log_success "Wine is installed: $(wine --version)"
        return 0
    else
        return 1
    fi
}

# Install Wine (shows instructions for WineHQ version 8+)
install_wine() {
    local current_ver=$(wine --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+' | head -1 || echo "not installed")

    log_error "Wine $MIN_WINE_VERSION.0+ is required (current: $current_ver)"
    echo ""
    log_info ".NET 8 Windows Forms requires Wine 8.0 or newer."
    log_info "Install from WineHQ repository for the latest version:"
    echo ""

    if command -v apt &> /dev/null; then
        # Detect Ubuntu/Debian version
        local distro=$(lsb_release -is 2>/dev/null | tr '[:upper:]' '[:lower:]')
        local codename=$(lsb_release -cs 2>/dev/null)

        echo "  # Remove old Wine first (if installed)"
        echo "  sudo apt remove --purge wine wine64 wine32 -y"
        echo ""
        echo "  # Enable 32-bit architecture"
        echo "  sudo dpkg --add-architecture i386"
        echo ""
        echo "  # Add WineHQ repository"
        echo "  sudo mkdir -pm755 /etc/apt/keyrings"
        echo "  sudo wget -O /etc/apt/keyrings/winehq-archive.key https://dl.winehq.org/wine-builds/winehq.key"
        echo "  sudo wget -NP /etc/apt/sources.list.d/ https://dl.winehq.org/wine-builds/${distro}/dists/${codename}/winehq-${codename}.sources"
        echo ""
        echo "  # Install Wine"
        echo "  sudo apt update"
        echo "  sudo apt install -y --install-recommends winehq-stable"
    elif command -v dnf &> /dev/null; then
        echo "  sudo dnf config-manager --add-repo https://dl.winehq.org/wine-builds/fedora/\$(rpm -E %fedora)/winehq.repo"
        echo "  sudo dnf install -y winehq-stable"
    elif command -v pacman &> /dev/null; then
        echo "  sudo pacman -S wine"
        echo "  # Arch usually has recent Wine versions"
    else
        echo "  Visit https://wiki.winehq.org/Download for installation instructions."
    fi

    echo ""
    log_info "After installing Wine 8+, run this script again."
    log_info "You may also need to remove the old Wine prefix:"
    echo "  rm -rf $WINEPREFIX"
    exit 1
}

# Initialize Wine prefix
init_wine_prefix() {
    log_info "Initializing Wine prefix at $WINEPREFIX..."
    export WINEPREFIX
    export WINEARCH=win64

    if [ ! -d "$WINEPREFIX/drive_c" ]; then
        # Initialize 64-bit Wine prefix quietly
        WINEDLLOVERRIDES="mscoree,mshtml=" WINEDEBUG=-all wineboot --init 2>/dev/null

        # Wait for Wine to finish initialization
        wineserver --wait 2>/dev/null || true

        log_success "Wine prefix initialized"
    else
        log_info "Wine prefix already exists"
    fi
}

# Check if .NET is installed in Wine
check_dotnet_in_wine() {
    export WINEPREFIX
    if [ -f "$WINEPREFIX/drive_c/dotnet/dotnet.exe" ]; then
        log_success ".NET SDK found in Wine prefix"
        return 0
    else
        return 1
    fi
}

# Install .NET SDK in Wine (using portable zip)
install_dotnet_in_wine() {
    export WINEPREFIX
    local DOTNET_DIR="$WINEPREFIX/drive_c/dotnet"
    local TEMP_DIR="$WINEPREFIX/temp"

    mkdir -p "$DOTNET_DIR" "$TEMP_DIR"

    # Fetch releases.json to get current download URLs
    log_info "Fetching .NET ${DOTNET_CHANNEL} release information..."
    local RELEASES_JSON="$TEMP_DIR/releases.json"
    curl -sL -o "$RELEASES_JSON" "$RELEASES_JSON_URL"

    # Extract the latest release's SDK and desktop runtime URLs for win-x64
    local SDK_URL=$(cat "$RELEASES_JSON" | grep -o '"url": *"[^"]*sdk[^"]*win-x64\.zip"' | head -1 | sed 's/.*"url": *"\([^"]*\)".*/\1/')
    local RUNTIME_URL=$(cat "$RELEASES_JSON" | grep -o '"url": *"[^"]*windowsdesktop[^"]*win-x64\.zip"' | head -1 | sed 's/.*"url": *"\([^"]*\)".*/\1/')

    if [ -z "$SDK_URL" ] || [ -z "$RUNTIME_URL" ]; then
        log_error "Could not find download URLs in releases.json"
        exit 1
    fi

    # Download SDK
    log_info "Downloading .NET SDK..."
    local SDK_ZIP="$TEMP_DIR/dotnet-sdk.zip"
    curl -L --progress-bar -o "$SDK_ZIP" "$SDK_URL"

    # Verify it's a valid zip
    if ! unzip -t "$SDK_ZIP" > /dev/null 2>&1; then
        log_error "Downloaded SDK file is not a valid zip"
        rm -f "$SDK_ZIP"
        exit 1
    fi

    # Download Desktop Runtime (needed for Windows Forms)
    log_info "Downloading .NET Desktop Runtime..."
    local RUNTIME_ZIP="$TEMP_DIR/dotnet-desktop-runtime.zip"
    curl -L --progress-bar -o "$RUNTIME_ZIP" "$RUNTIME_URL"

    # Verify it's a valid zip
    if ! unzip -t "$RUNTIME_ZIP" > /dev/null 2>&1; then
        log_error "Downloaded runtime file is not a valid zip"
        rm -f "$RUNTIME_ZIP"
        exit 1
    fi

    # Extract SDK
    log_info "Extracting .NET SDK..."
    unzip -q -o "$SDK_ZIP" -d "$DOTNET_DIR"

    # Extract Desktop Runtime (overlays on top of SDK)
    log_info "Extracting .NET Desktop Runtime..."
    unzip -q -o "$RUNTIME_ZIP" -d "$DOTNET_DIR"

    # Clean up
    rm -rf "$TEMP_DIR"

    # Verify installation
    if [ -f "$DOTNET_DIR/dotnet.exe" ]; then
        log_success ".NET SDK installed successfully"
    else
        log_error "Failed to install .NET SDK"
        exit 1
    fi
}

# Find the project file (prefer .csproj for building with runtime identifier)
find_project_file() {
    # Look for .csproj first (needed for --runtime builds)
    local csproj_file=$(find "$SCRIPT_DIR" -maxdepth 1 -name "*.csproj" | head -1)
    if [ -n "$csproj_file" ]; then
        echo "$csproj_file"
        return
    fi

    # Fallback to .sln
    local sln_file=$(find "$SCRIPT_DIR" -maxdepth 1 -name "*.sln" | head -1)
    if [ -n "$sln_file" ]; then
        echo "$sln_file"
        return
    fi

    log_error "No .csproj or .sln file found in $SCRIPT_DIR"
    exit 1
}

# Get the output exe name from the project
get_output_name() {
    local project_file="$1"
    local base_name=$(basename "$project_file")

    # Remove extension
    if [[ "$base_name" == *.sln ]]; then
        # For solution files, look for the first csproj
        local csproj=$(find "$SCRIPT_DIR" -name "*.csproj" | head -1)
        base_name=$(basename "$csproj")
    fi

    echo "${base_name%.*}.exe"
}

# Convert Linux path to Wine path
to_wine_path() {
    echo "Z:$1" | sed 's|/|\\|g'
}

# Find native dotnet
find_native_dotnet() {
    # Check common locations
    if [ -x "$HOME/.dotnet/dotnet" ]; then
        echo "$HOME/.dotnet/dotnet"
    elif command -v dotnet &> /dev/null; then
        echo "dotnet"
    else
        return 1
    fi
}

# Build the project using native Linux dotnet (cross-compile for Windows)
build_project() {
    local dotnet_cmd=$(find_native_dotnet)

    if [ -z "$dotnet_cmd" ]; then
        log_error "Native .NET SDK not found. Install with:"
        echo "  wget -qO- https://dot.net/v1/dotnet-install.sh | bash -s -- --channel 8.0"
        exit 1
    fi

    local project_file=$(find_project_file)

    log_info "Building project: $(basename "$project_file")"
    log_info "Using native dotnet: $dotnet_cmd"

    # Build using native Linux dotnet, targeting Windows
    # EnableWindowsTargeting allows cross-compiling Windows Forms on Linux
    "$dotnet_cmd" build "$project_file" \
        --configuration Release \
        --runtime win-x64 \
        --self-contained true \
        -p:EnableWindowsTargeting=true \
        -p:PublishSingleFile=false

    if [ $? -eq 0 ]; then
        log_success "Build completed"
    else
        log_error "Build failed"
        exit 1
    fi
}

# Restore NuGet packages using native dotnet
restore_packages() {
    local dotnet_cmd=$(find_native_dotnet)

    if [ -z "$dotnet_cmd" ]; then
        log_error "Native .NET SDK not found"
        exit 1
    fi

    local project_file=$(find_project_file)

    log_info "Restoring NuGet packages..."

    "$dotnet_cmd" restore "$project_file" --runtime win-x64 -p:EnableWindowsTargeting=true

    if [ $? -eq 0 ]; then
        log_success "Packages restored"
    else
        log_warn "Restore may have had issues, continuing..."
    fi
}

# Find the built executable
find_executable() {
    local exe_name=$(get_output_name "$(find_project_file)")

    # Look in common output directories
    local search_paths=(
        "$SCRIPT_DIR/bin/Release/net8.0-windows/win-x64"
        "$SCRIPT_DIR/bin/Release/net8.0-windows"
        "$SCRIPT_DIR/bin/Release/net7.0-windows/win-x64"
        "$SCRIPT_DIR/bin/Release/net7.0-windows"
        "$SCRIPT_DIR/bin/Release/net6.0-windows/win-x64"
        "$SCRIPT_DIR/bin/Release/net6.0-windows"
        "$SCRIPT_DIR/bin/Release"
        "$SCRIPT_DIR/bin/Debug/net8.0-windows/win-x64"
        "$SCRIPT_DIR/bin/Debug/net8.0-windows"
        "$SCRIPT_DIR/bin/Debug"
    )

    for path in "${search_paths[@]}"; do
        if [ -f "$path/$exe_name" ]; then
            echo "$path/$exe_name"
            return
        fi
    done

    # Fallback: search recursively
    local found=$(find "$SCRIPT_DIR/bin" -name "$exe_name" 2>/dev/null | head -1)
    if [ -n "$found" ]; then
        echo "$found"
        return
    fi

    return 1
}

# Run the application
run_app() {
    export WINEPREFIX
    export WINEDEBUG=-all

    local exe_path=$(find_executable)

    if [ -z "$exe_path" ]; then
        log_warn "Executable not found, building first..."
        restore_packages
        build_project
        exe_path=$(find_executable)
    fi

    if [ -z "$exe_path" ]; then
        log_error "Could not find executable after build"
        exit 1
    fi

    log_info "Running: $(basename "$exe_path")"

    # Change to the exe directory so relative paths work
    local exe_dir=$(dirname "$exe_path")
    local exe_name=$(basename "$exe_path")

    cd "$exe_dir"
    wine "$exe_name" 2>&1 | grep -v "^wine:" || true
}

# Clean build artifacts
clean_build() {
    log_info "Cleaning build artifacts..."
    rm -rf "$SCRIPT_DIR/bin" "$SCRIPT_DIR/obj"
    log_success "Clean completed"
}

# Full setup
setup() {
    log_info "Setting up Wine environment for .NET Windows Forms applications..."

    # Check/install Wine
    if ! check_wine; then
        install_wine
    fi

    # Initialize Wine prefix
    init_wine_prefix

    # Check/install .NET in Wine
    if ! check_dotnet_in_wine; then
        install_dotnet_in_wine
    fi

    log_success "Setup complete! You can now run Windows Forms applications."
}

# Show status
status() {
    echo "=== Wine .NET Environment Status ==="
    echo ""

    if check_wine; then
        echo "  Wine: $(wine --version 2>/dev/null)"
    else
        echo "  Wine: NOT INSTALLED"
    fi

    echo "  Wine Prefix: $WINEPREFIX"

    if [ -d "$WINEPREFIX" ]; then
        echo "  Prefix Status: EXISTS"
    else
        echo "  Prefix Status: NOT INITIALIZED"
    fi

    if [ -f "$WINEPREFIX/drive_c/dotnet/dotnet.exe" ]; then
        echo "  .NET SDK: INSTALLED"
    else
        echo "  .NET SDK: NOT INSTALLED"
    fi

    echo ""
    local project_file=$(find_project_file 2>/dev/null)
    if [ -n "$project_file" ]; then
        echo "  Project: $(basename "$project_file")"
    fi

    local exe_path=$(find_executable 2>/dev/null)
    if [ -n "$exe_path" ]; then
        echo "  Built Executable: $exe_path"
    else
        echo "  Built Executable: NOT FOUND (run 'build' first)"
    fi
}

# Main entry point
main() {
    local command="${1:-run}"

    case "$command" in
        setup)
            setup
            ;;
        build)
            setup
            restore_packages
            build_project
            ;;
        run)
            setup
            run_app
            ;;
        clean)
            clean_build
            ;;
        status)
            status
            ;;
        help|--help|-h)
            echo "Usage: $0 [setup|build|run|clean|status|help]"
            echo ""
            echo "Commands:"
            echo "  setup   - Install Wine and .NET runtime"
            echo "  build   - Build the project"
            echo "  run     - Run the application (default)"
            echo "  clean   - Remove build artifacts"
            echo "  status  - Show environment status"
            echo "  help    - Show this help message"
            echo ""
            echo "Environment variables:"
            echo "  WINEPREFIX - Wine prefix directory (default: ~/.wine-dotnet)"
            echo ""
            echo "This script is portable - copy it to any .NET Windows Forms project!"
            ;;
        *)
            log_error "Unknown command: $command"
            echo "Use '$0 help' for usage information"
            exit 1
            ;;
    esac
}

main "$@"
