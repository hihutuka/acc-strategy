// acc app.cpp : このファイルには 'main' 関数が含まれています。プログラム実行の開始と終了がそこで行われます。
//

#define WIN32_LEAN_AND_MEAN

#include <algorithm>
#include <array>
#include <atomic>
#include <chrono>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstring>
#include <iomanip>
#include <iostream>
#include <mutex>
#include <sstream>
#include <string>
#include <string_view>
#include <thread>
#include <vector>

using BYTE = unsigned char;
using BOOL = int;
using DWORD = unsigned long;
using HANDLE = void*;
using HCRYPTPROV = std::uintptr_t;
using HCRYPTHASH = std::uintptr_t;
using LPCSTR = const char*;
using LPCWSTR = const wchar_t*;
using LPVOID = void*;
using LPCVOID = const void*;
using SIZE_T = std::size_t;
using SOCKET = std::uintptr_t;
using WORD = unsigned short;

constexpr BOOL FALSE = 0;
constexpr BOOL TRUE = 1;
constexpr WORD MakeWord(BYTE low, BYTE high)
{
    return static_cast<WORD>((static_cast<WORD>(high) << 8) | low);
}

struct in_addr
{
    std::uint32_t s_addr;
};

struct sockaddr
{
    unsigned short sa_family;
    char sa_data[14];
};

struct sockaddr_in
{
    short sin_family;
    unsigned short sin_port;
    in_addr sin_addr;
    char sin_zero[8];
};

struct WSAData
{
    unsigned short wVersion;
    unsigned short wHighVersion;
    char szDescription[257];
    char szSystemStatus[129];
    unsigned short iMaxSockets;
    unsigned short iMaxUdpDg;
    char* lpVendorInfo;
};
using WSADATA = WSAData;

constexpr SOCKET INVALID_SOCKET = static_cast<SOCKET>(~0ull);
constexpr int SOCKET_ERROR = -1;
constexpr int AF_INET = 2;
constexpr int SOCK_STREAM = 1;
constexpr int IPPROTO_TCP = 6;
constexpr int SD_BOTH = 2;
constexpr DWORD FILE_MAP_READ = 0x0004;
constexpr DWORD PROV_RSA_AES = 24;
constexpr DWORD CRYPT_VERIFYCONTEXT = 0xF0000000;
constexpr DWORD CALG_SHA1 = 0x00008004;
constexpr DWORD HP_HASHVAL = 0x0002;
constexpr DWORD CRYPT_STRING_BASE64 = 0x00000001;
constexpr DWORD CRYPT_STRING_NOCRLF = 0x40000000;
constexpr int SOMAXCONN = 0x7fffffff;
constexpr std::uint32_t INADDR_ANY = 0x00000000;
constexpr unsigned short htons(unsigned short value)
{
    return static_cast<unsigned short>((value << 8) | (value >> 8));
}
constexpr std::uint32_t htonl(std::uint32_t value)
{
    return ((value & 0x000000FFu) << 24) |
           ((value & 0x0000FF00u) << 8) |
           ((value & 0x00FF0000u) >> 8) |
           ((value & 0xFF000000u) >> 24);
}

extern "C"
{
    __declspec(dllimport) HANDLE __stdcall OpenFileMappingW(DWORD, BOOL, LPCWSTR);
    __declspec(dllimport) LPVOID __stdcall MapViewOfFile(HANDLE, DWORD, DWORD, DWORD, SIZE_T);
    __declspec(dllimport) BOOL __stdcall UnmapViewOfFile(LPCVOID);
    __declspec(dllimport) BOOL __stdcall CloseHandle(HANDLE);

    __declspec(dllimport) int __stdcall WSAStartup(unsigned short, WSADATA*);
    __declspec(dllimport) int __stdcall WSACleanup();
    __declspec(dllimport) SOCKET __stdcall socket(int, int, int);
    __declspec(dllimport) int __stdcall bind(SOCKET, const sockaddr*, int);
    __declspec(dllimport) int __stdcall listen(SOCKET, int);
    __declspec(dllimport) SOCKET __stdcall accept(SOCKET, sockaddr*, int*);
    __declspec(dllimport) int __stdcall recv(SOCKET, char*, int, int);
    __declspec(dllimport) int __stdcall send(SOCKET, const char*, int, int);
    __declspec(dllimport) int __stdcall shutdown(SOCKET, int);
    __declspec(dllimport) int __stdcall closesocket(SOCKET);
    __declspec(dllimport) int __stdcall setsockopt(SOCKET, int, int, const char*, int);

    constexpr int SOL_SOCKET = 0xFFFF;
    constexpr int SO_REUSEADDR = 0x0004;

    __declspec(dllimport) BOOL __stdcall CryptAcquireContextW(HCRYPTPROV*, LPCWSTR, LPCWSTR, DWORD, DWORD);
    __declspec(dllimport) BOOL __stdcall CryptCreateHash(HCRYPTPROV, DWORD, std::uintptr_t, DWORD, HCRYPTHASH*);
    __declspec(dllimport) BOOL __stdcall CryptHashData(HCRYPTHASH, const BYTE*, DWORD, DWORD);
    __declspec(dllimport) BOOL __stdcall CryptGetHashParam(HCRYPTHASH, DWORD, BYTE*, DWORD*, DWORD);
    __declspec(dllimport) BOOL __stdcall CryptDestroyHash(HCRYPTHASH);
    __declspec(dllimport) BOOL __stdcall CryptReleaseContext(HCRYPTPROV, DWORD);
    __declspec(dllimport) BOOL __stdcall CryptBinaryToStringA(const BYTE*, DWORD, DWORD, char*, DWORD*);
}

#pragma comment(lib, "Ws2_32.lib")
#pragma comment(lib, "Crypt32.lib")
#pragma comment(lib, "Advapi32.lib")

namespace
{
    constexpr const wchar_t* kPhysicsMappingName = L"Local\\acpmf_physics";
    constexpr const wchar_t* kGraphicsMappingName = L"Local\\acpmf_graphics";
    constexpr const wchar_t* kStaticMappingName = L"Local\\acpmf_static";
    constexpr std::uint16_t kWebSocketPort = 8081;
    constexpr std::string_view kWebSocketGuid = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

    std::string Trim(std::string value)
    {
        const auto first = value.find_first_not_of(" \t\r\n");
        if (first == std::string::npos)
        {
            return {};
        }

        const auto last = value.find_last_not_of(" \t\r\n");
        return value.substr(first, last - first + 1);
    }

    std::string ToLowerAscii(std::string_view value)
    {
        std::string result;
        result.reserve(value.size());
        for (const char ch : value)
        {
            if (ch >= 'A' && ch <= 'Z')
            {
                result.push_back(static_cast<char>(ch - 'A' + 'a'));
            }
            else
            {
                result.push_back(ch);
            }
        }

        return result;
    }

    std::string FindHttpHeader(std::string_view request, std::string_view headerName)
    {
        const std::string wanted = ToLowerAscii(headerName);
        std::size_t lineStart = 0;

        while (lineStart < request.size())
        {
            const std::size_t lineEnd = request.find("\r\n", lineStart);
            if (lineEnd == std::string_view::npos || lineEnd == lineStart)
            {
                break;
            }

            const std::string_view line = request.substr(lineStart, lineEnd - lineStart);
            const std::size_t colon = line.find(':');
            if (colon != std::string_view::npos)
            {
                const std::string name = ToLowerAscii(line.substr(0, colon));
                if (name == wanted)
                {
                    return Trim(std::string(line.substr(colon + 1)));
                }
            }

            lineStart = lineEnd + 2;
        }

        return {};
    }

    float CleanFloat(float value)
    {
        return std::isfinite(value) ? value : 0.0f;
    }

    std::string JsonEscape(std::string_view value)
    {
        std::ostringstream oss;
        for (const unsigned char ch : value)
        {
            switch (ch)
            {
            case '"':
                oss << "\\\"";
                break;
            case '\\':
                oss << "\\\\";
                break;
            case '\b':
                oss << "\\b";
                break;
            case '\f':
                oss << "\\f";
                break;
            case '\n':
                oss << "\\n";
                break;
            case '\r':
                oss << "\\r";
                break;
            case '\t':
                oss << "\\t";
                break;
            default:
                if (ch < 0x20)
                {
                    oss << "\\u"
                        << std::hex << std::uppercase << std::setw(4) << std::setfill('0')
                        << static_cast<int>(ch)
                        << std::dec << std::nouppercase << std::setfill(' ');
                }
                else
                {
                    oss << static_cast<char>(ch);
                }
                break;
            }
        }

        return oss.str();
    }

    template <std::size_t Size>
    std::string NarrowWideText(const wchar_t (&value)[Size])
    {
        std::string result;
        result.reserve(Size);
        for (wchar_t ch : value)
        {
            if (ch == L'\0')
            {
                break;
            }

            result.push_back(ch >= 0 && ch <= 0x7F ? static_cast<char>(ch) : '?');
        }

        return result;
    }
}

struct TelemetrySnapshot
{
    // ===== Physics =====
    int packetId = 0;

    float throttle = 0.0f;
    float brake = 0.0f;

    float fuel = 0.0f;
    float fuelPerLap = 0.0f;

    int gear = 0;
    int rpm = 0;

    float steerAngle = 0.0f;
    float speedKmh = 0.0f;

    // ===== Graphics =====

    int currentLap = 0;
    int position = 0;

    std::string currentLapTime;
    std::string lastLapTime;
    std::string bestLapTime;

    bool isInPit = false;
    bool isInPitLane = false;

    int flag = 0;

    int rainIntensity = 0;
    int trackGripStatus = 0;
    float idealLineGrip = 0.0f;
    int rainIntensityIn10min = 0;
    int rainIntensityIn30min = 0;
    float roadTemp = 0.0f;

    // ===== Static =====

    float trackLength = 0.0f;
    float maxFuel = 0.0f;

    // ===== Tyres (physics, index順: FL, FR, RL, RR) =====
    float tyrePressure[4] = { 0.0f, 0.0f, 0.0f, 0.0f };
    float tyreWear[4] = { 0.0f, 0.0f, 0.0f, 0.0f };       // ACCの仕様: 0=新品, 100=完全摩耗
    float tyreTemp[4] = { 0.0f, 0.0f, 0.0f, 0.0f };

    // ===== Session =====
    int sessionType = 0;          // AC_SESSION_TYPE (-1=Unknown,0=Practice,1=Qualify,2=Race,...)
    float sessionTimeLeft = 0.0f; // 秒
    int numberOfLaps = 0;         // 周回数ベースのセッションでの総周回数(時間ベースなら0)

    bool connected = false;

    std::string ToJson() const
    {
        std::ostringstream oss;

        oss << "{";

        oss << "\"packetId\":" << packetId << ",";
        oss << "\"throttle\":" << CleanFloat(throttle) << ",";
        oss << "\"brake\":" << CleanFloat(brake) << ",";
        oss << "\"fuel\":" << CleanFloat(fuel) << ",";
        oss << "\"fuelPerLap\":" << CleanFloat(fuelPerLap) << ",";

        oss << "\"gear\":" << gear << ",";
        oss << "\"rpm\":" << rpm << ",";
        oss << "\"steerAngle\":" << CleanFloat(steerAngle) << ",";
        oss << "\"speedKmh\":" << CleanFloat(speedKmh) << ",";

        oss << "\"lap\":" << currentLap << ",";
        oss << "\"position\":" << position << ",";

        oss << "\"currentLapTime\":\"" << JsonEscape(currentLapTime) << "\",";
        oss << "\"lastLapTime\":\"" << JsonEscape(lastLapTime) << "\",";
        oss << "\"bestLapTime\":\"" << JsonEscape(bestLapTime) << "\",";

        oss << "\"isInPit\":" << (isInPit ? "true" : "false") << ",";
        oss << "\"isInPitLane\":" << (isInPitLane ? "true" : "false") << ",";

        oss << "\"flag\":" << flag << ",";
        oss << "\"rainIntensity\":" << rainIntensity << ",";
        oss << "\"trackGripStatus\":" << trackGripStatus << ",";
        oss << "\"idealLineGrip\":" << CleanFloat(idealLineGrip) << ",";
        oss << "\"rainIntensityIn10min\":" << rainIntensityIn10min << ",";
        oss << "\"rainIntensityIn30min\":" << rainIntensityIn30min << ",";
        oss << "\"roadTemp\":" << CleanFloat(roadTemp) << ",";

        oss << "\"trackLength\":" << CleanFloat(trackLength) << ",";
        oss << "\"maxFuel\":" << CleanFloat(maxFuel) << ",";

        oss << "\"tyrePressure\":[" << CleanFloat(tyrePressure[0]) << "," << CleanFloat(tyrePressure[1]) << ","
            << CleanFloat(tyrePressure[2]) << "," << CleanFloat(tyrePressure[3]) << "],";
        oss << "\"tyreWear\":[" << CleanFloat(tyreWear[0]) << "," << CleanFloat(tyreWear[1]) << ","
            << CleanFloat(tyreWear[2]) << "," << CleanFloat(tyreWear[3]) << "],";
        oss << "\"tyreTemp\":[" << CleanFloat(tyreTemp[0]) << "," << CleanFloat(tyreTemp[1]) << ","
            << CleanFloat(tyreTemp[2]) << "," << CleanFloat(tyreTemp[3]) << "],";

        oss << "\"sessionType\":" << sessionType << ",";
        oss << "\"sessionTimeLeft\":" << CleanFloat(sessionTimeLeft) << ",";
        oss << "\"numberOfLaps\":" << numberOfLaps << ",";

        oss << "\"connected\":" << (connected ? "true" : "false");

        oss << "}";

        return oss.str();
    }
};

struct StrategyAdvice
{
    bool pitRecommended = false;
    int estimatedLapsRemaining = 0;
    std::string summary;
};

struct TelemetryFrame
{
    TelemetrySnapshot telemetry;
    StrategyAdvice strategy;

    std::string ToJson() const
    {
        std::ostringstream oss;
        oss << "{";
        oss << "\"telemetry\":" << telemetry.ToJson() << ",";
        oss << "\"strategy\":{";
        oss << "\"pitRecommended\":" << (strategy.pitRecommended ? "true" : "false") << ",";
        oss << "\"estimatedLapsRemaining\":" << strategy.estimatedLapsRemaining << ",";
        oss << "\"summary\":\"" << JsonEscape(strategy.summary) << "\"";
        oss << "}";
        oss << "}";
        return oss.str();
    }
};

class SharedMemoryReader
{
public:
    SharedMemoryReader()
        : startTime_(std::chrono::steady_clock::now())
    {
    }

    ~SharedMemoryReader()
    {
        CloseView(physicsMapping_, physicsView_);
        CloseView(graphicsMapping_, graphicsView_);
        CloseView(staticMapping_, staticView_);
    }

    bool Connect()
    {
        OpenView(kPhysicsMappingName, physicsMapping_, physicsView_);
        OpenView(kGraphicsMappingName, graphicsMapping_, graphicsView_);
        OpenView(kStaticMappingName, staticMapping_, staticView_);

        connected_ = physicsView_ != nullptr || graphicsView_ != nullptr || staticView_ != nullptr;
        return connected_;
    }

    TelemetrySnapshot ReadSnapshot()
    {
        Connect();

        if (!connected_)
        {
            return CreateFallbackSnapshot();
        }

        TelemetrySnapshot snapshot;

        if (physicsView_ != nullptr)
        {
            snapshot.packetId = physicsView_->packetId;
            snapshot.throttle = CleanFloat(physicsView_->gas);
            snapshot.brake = CleanFloat(physicsView_->brake);
            snapshot.fuel = CleanFloat(physicsView_->fuel);
            snapshot.gear = physicsView_->gear;
            snapshot.rpm = physicsView_->rpms;
            snapshot.steerAngle = CleanFloat(physicsView_->steerAngle);
            snapshot.speedKmh = CleanFloat(physicsView_->speedKmh);
            snapshot.roadTemp = CleanFloat(physicsView_->roadTemp);
            for (int i = 0; i < 4; ++i)
            {
                snapshot.tyrePressure[i] = CleanFloat(physicsView_->wheelsPressure[i]);
                snapshot.tyreWear[i] = CleanFloat(physicsView_->tyreWear[i]);
                snapshot.tyreTemp[i] = CleanFloat(physicsView_->tyreCoreTemperature[i]);
            }
        }

        if (graphicsView_ != nullptr)
        {
            snapshot.packetId = graphicsView_->packetId;
            snapshot.currentLap = graphicsView_->completedLaps;
            snapshot.position = graphicsView_->position;
            snapshot.currentLapTime = NarrowWideText(graphicsView_->currentTime);
            snapshot.lastLapTime = NarrowWideText(graphicsView_->lastTime);
            snapshot.bestLapTime = NarrowWideText(graphicsView_->bestTime);
            snapshot.isInPit = graphicsView_->isInPit != 0;
            snapshot.isInPitLane = graphicsView_->isInPitLane != 0;
            snapshot.flag = graphicsView_->flag;
            snapshot.rainIntensity = graphicsView_->rainIntensity;
            snapshot.trackGripStatus = graphicsView_->trackGripStatus;
            snapshot.idealLineGrip = CleanFloat(graphicsView_->surfaceGrip);
            snapshot.rainIntensityIn10min = graphicsView_->rainIntensityIn10min;
            snapshot.rainIntensityIn30min = graphicsView_->rainIntensityIn30min;
            snapshot.sessionType = graphicsView_->session;
            snapshot.sessionTimeLeft = CleanFloat(graphicsView_->sessionTimeLeft);
            snapshot.numberOfLaps = graphicsView_->numberOfLaps;

            snapshot.fuelPerLap = CleanFloat(graphicsView_->fuelXLap);
            if (snapshot.fuelPerLap <= 0.01f && graphicsView_->fuelEstimatedLaps > 0.01f && snapshot.fuel > 0.01f)
            {
                snapshot.fuelPerLap = snapshot.fuel / graphicsView_->fuelEstimatedLaps;
            }
            else if (snapshot.fuelPerLap <= 0.01f && graphicsView_->completedLaps > 0 && graphicsView_->usedFuel > 0.01f)
            {
                snapshot.fuelPerLap = graphicsView_->usedFuel / static_cast<float>(graphicsView_->completedLaps);
            }
        }

        if (staticView_ != nullptr)
        {
            snapshot.trackLength = CleanFloat(staticView_->trackSplineLength);
            snapshot.maxFuel = CleanFloat(staticView_->maxFuel);
        }

        snapshot.connected = physicsView_ != nullptr || graphicsView_ != nullptr;
        return snapshot;
    }

private:
    struct SPageFilePhysics
    {
        int packetId;
        float gas;
        float brake;
        float fuel;
        int gear;
        int rpms;
        float steerAngle;
        float speedKmh;
        float velocity[3];
        float accG[3];
        float wheelSlip[4];
        float wheelLoad[4];
        float wheelsPressure[4];
        float wheelAngularSpeed[4];
        float tyreWear[4];
        float tyreDirtyLevel[4];
        float tyreCoreTemperature[4];
        float camberRAD[4];
        float suspensionTravel[4];
        float drs;
        float tc;
        float heading;
        float pitch;
        float roll;
        float cgHeight;
        float carDamage[5];
        int numberOfTyresOut;
        int pitLimiterOn;
        float abs;
        float kersCharge;
        float kersInput;
        int autoShifterOn;
        float rideHeight[2];
        float turboBoost;
        float ballast;
        float airDensity;
        float airTemp;
        float roadTemp;
        float localAngularVel[3];
        float finalFF;
        float performanceMeter;
        int engineBrake;
        int ersRecoveryLevel;
        int ersPowerLevel;
        int ersHeatCharging;
        int ersIsCharging;
        float kersCurrentKJ;
        int drsAvailable;
        int drsEnabled;
        float brakeTemp[4];
        float clutch;
        float tyreTempI[4];
        float tyreTempM[4];
        float tyreTempO[4];
        int isAIControlled;
        float tyreContactPoint[4][3];
        float tyreContactNormal[4][3];
        float tyreContactHeading[4][3];
        float brakeBias;
        float localVelocity[3];
        int P2PActivations;
        int P2PStatus;
        float currentMaxRpm;
        float mz[4];
        float fx[4];
        float fy[4];
        float slipRatio[4];
        float slipAngle[4];
        int tcinAction;
        int absInAction;
        float suspensionDamage[4];
        float tyreTemp[4];
        float waterTemp;
        float brakePressure[4];
        int frontBrakeCompound;
        int rearBrakeCompound;
        float padLife[4];
        float discLife[4];
        int ignitionOn;
        int starterEngineOn;
        int isEngineRunning;
        float kerbVibration;
        float slipVibrations;
        float gVibrations;
        float absVibrations;
    };

    struct SPageFileGraphic
    {
        int packetId;

        int status;

        int session;

        wchar_t currentTime[15];

        wchar_t lastTime[15];

        wchar_t bestTime[15];

        wchar_t split[15];

        int completedLaps;

        int position;

        int iCurrentTime;

        int iLastTime;

        int iBestTime;

        float sessionTimeLeft;

        float distanceTraveled;

        int isInPit;

        int currentSectorIndex;

        int lastSectorTime;

        int numberOfLaps;

        wchar_t tyreCompound[33];

        float replayTimeMultiplier;

        float normalizedCarPosition;

        int activeCars;

        float carCoordinates[60][3];

        int carID[60];

        int playerCarID;

        float penaltyTime;

        int flag;

        int penalty;

        int idealLineOn;

        int isInPitLane;

        float surfaceGrip;

        int mandatoryPitDone;

        float windSpeed;

        float windDirection;

        int isSetupMenuVisible;

        int mainDisplayIndex;

        int secondaryDisplayIndex;

        int TC;

        int TCCut;

        int EngineMap;

        int ABS;

        float fuelXLap;

        int rainLights;

        int flashingLights;

        int lightsStage;

        float exhaustTemperature;

        int wiperLV;

        int driverStintTotalTimeLeft;

        int driverStintTimeLeft;

        int rainTyres;

        int sessionIndex;

        float usedFuel;

        wchar_t deltaLapTime[15];

        int iDeltaLapTime;

        wchar_t estimatedLapTime[15];

        int iEstimatedLapTime;

        int isDeltaPositive;

        int iSplit;

        int isValidLap;

        float fuelEstimatedLaps;

        wchar_t trackStatus[33];

        int missingMandatoryPits;

        float clock;

        int directionLightsLeft;

        int directionLightsRight;

        int globalYellow;

        int globalYellow1;

        int globalYellow2;

        int globalYellow3;

        int globalWhite;

        int globalGreen;

        int globalChequered;

        int globalRed;

        int mfdTyreSet;

        float mfdFuelToAdd;

        float mfdTyrePressureLF;

        float mfdTyrePressureRF;

        float mfdTyrePressureLR;

        float mfdTyrePressureRR;

        int trackGripStatus;

        int rainIntensity;

        int rainIntensityIn10min;

        int rainIntensityIn30min;

        int currentTyreSet;

        int strategyTyreSet;

        int gapAhead;

        int gapBehind;
    };

    struct SPageFileStatic
    {
        wchar_t smVersion[15];
        wchar_t acVersion[15];
        int numberOfSessions;
        int numCars;
        wchar_t carModel[33];
        wchar_t track[33];
        wchar_t playerName[33];
        wchar_t playerSurname[33];
        wchar_t playerNick[33];
        int sectorCount;
        float maxTorque;
        float maxPower;
        int maxRpm;
        float maxFuel;
        float suspensionMaxTravel[4];
        float tyreRadius[4];
        float maxTurboBoost;
        float deprecated1;
        float deprecated2;
        int penaltiesEnabled;
        float aidFuelRate;
        float aidTireRate;
        float aidMechanicalDamage;
        int aidAllowTyreBlankets;
        float aidStability;
        int aidAutoClutch;
        int aidAutoBlip;
        int hasDRS;
        int hasERS;
        int hasKERS;
        float kersMaxJ;
        int engineBrakeSettingsCount;
        int ersPowerControllerCount;
        float trackSplineLength;
        wchar_t trackConfiguration[33];
        float ersMaxJ;
        int isTimedRace;
        int hasExtraLap;
        wchar_t carSkin[33];
        int reversedGridPositions;
        int pitWindowStart;
        int pitWindowEnd;
        int isOnline;
        wchar_t dryTyresName[33];
        wchar_t wetTyresName[33];
    };

    static_assert(offsetof(SPageFilePhysics, speedKmh) == 28, "Unexpected SPageFilePhysics layout.");
    static_assert(offsetof(SPageFileGraphic, completedLaps) == 132, "Unexpected SPageFileGraphic layout.");

    template <typename View>
    static bool OpenView(const wchar_t* mappingName, HANDLE& mapping, View*& view)
    {
        if (view != nullptr)
        {
            return true;
        }

        mapping = OpenFileMappingW(FILE_MAP_READ, FALSE, mappingName);
        if (mapping == nullptr)
        {
            return false;
        }

        view = static_cast<View*>(MapViewOfFile(mapping, FILE_MAP_READ, 0, 0, 0));
        if (view == nullptr)
        {
            CloseHandle(mapping);
            mapping = nullptr;
            return false;
        }

        return true;
    }

    template <typename View>
    static void CloseView(HANDLE& mapping, View*& view)
    {
        if (view != nullptr)
        {
            UnmapViewOfFile(view);
            view = nullptr;
        }

        if (mapping != nullptr)
        {
            CloseHandle(mapping);
            mapping = nullptr;
        }
    }

    TelemetrySnapshot CreateFallbackSnapshot() const
    {
        using namespace std::chrono;

        const auto elapsed = duration_cast<duration<float>>(steady_clock::now() - startTime_).count();
        TelemetrySnapshot snapshot;
        snapshot.packetId = static_cast<int>(elapsed * 20.0f);
        snapshot.throttle = (std::sin(elapsed) + 1.0f) * 0.5f;
        snapshot.brake = (std::cos(elapsed * 0.7f) + 1.0f) * 0.15f;
        snapshot.fuel = 60.0f - elapsed * 0.05f;
        snapshot.gear = static_cast<int>(elapsed) % 6 + 1;
        snapshot.rpm = 3500 + static_cast<int>(std::sin(elapsed * 2.0f) * 1200.0f);
        snapshot.steerAngle = std::sin(elapsed * 1.8f) * 0.3f;
        snapshot.speedKmh = 80.0f + std::sin(elapsed * 0.9f) * 25.0f;
        snapshot.fuelPerLap = 2.7f;
        snapshot.maxFuel = 110.0f;
        snapshot.roadTemp = 28.0f;
        snapshot.trackGripStatus = 2; // Optimum
        snapshot.rainIntensity = 0;
        snapshot.rainIntensityIn10min = 0;
        snapshot.rainIntensityIn30min = 0;
        for (int i = 0; i < 4; ++i)
        {
            snapshot.tyrePressure[i] = 27.0f;
            snapshot.tyreWear[i] = 5.0f + std::sin(elapsed * 0.05f + i) * 1.0f;
            snapshot.tyreTemp[i] = 85.0f + std::sin(elapsed * 0.3f + i) * 8.0f;
        }
        snapshot.sessionType = 2; // Race
        snapshot.sessionTimeLeft = 3600.0f;
        snapshot.numberOfLaps = 0;
        snapshot.connected = false;
        return snapshot;
    }

    HANDLE physicsMapping_ = nullptr;
    HANDLE graphicsMapping_ = nullptr;
    HANDLE staticMapping_ = nullptr;

    SPageFilePhysics* physicsView_ = nullptr;
    SPageFileGraphic* graphicsView_ = nullptr;
    SPageFileStatic* staticView_ = nullptr;

    bool connected_ = false;
    mutable std::chrono::steady_clock::time_point startTime_;
};

class TelemetryService
{
public:
    TelemetryService()
    {
        reader_.Connect();
    }

    TelemetryFrame Sample()
    {
        TelemetryFrame frame;
        frame.telemetry = reader_.ReadSnapshot();
        frame.strategy = BuildStrategy(frame.telemetry);
        return frame;
    }

private:
    StrategyAdvice BuildStrategy(const TelemetrySnapshot& snapshot) const
    {
        StrategyAdvice advice;
        const float fuelPerLap = snapshot.fuelPerLap > 0.01f ? snapshot.fuelPerLap : 2.7f;
        advice.estimatedLapsRemaining = snapshot.fuel > 0.0f ? static_cast<int>(snapshot.fuel / fuelPerLap) : 0;

        if (snapshot.fuel < 10.0f)
        {
            advice.pitRecommended = true;
            advice.summary = "Fuel low: pit window is open.";
        }
        else
        {
            advice.summary = "Telemetry stable. Maintain pace.";
        }

        return advice;
    }

    SharedMemoryReader reader_;
};

class WebSocketServer
{
public:
    WebSocketServer()
    {
        WSADATA data{};
        WSAStartup(MakeWord(2, 2), &data);
    }

    ~WebSocketServer()
    {
        Stop();
        WSACleanup();
    }

    bool Start(std::uint16_t port)
    {
        if (running_)
        {
            return true;
        }

        listenSocket_ = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
        if (listenSocket_ == INVALID_SOCKET)
        {
            return false;
        }

        // アプリ再起動直後にポートがTIME_WAITで残っていてもbindできるようにする
        const int reuse = 1;
        setsockopt(listenSocket_, SOL_SOCKET, SO_REUSEADDR, reinterpret_cast<const char*>(&reuse), sizeof(reuse));

        sockaddr_in address{};
        address.sin_family = AF_INET;
        address.sin_port = htons(port);
        address.sin_addr.s_addr = htonl(INADDR_ANY);

        if (bind(listenSocket_, reinterpret_cast<sockaddr*>(&address), sizeof(address)) == SOCKET_ERROR)
        {
            closesocket(listenSocket_);
            listenSocket_ = INVALID_SOCKET;
            return false;
        }

        if (listen(listenSocket_, SOMAXCONN) == SOCKET_ERROR)
        {
            closesocket(listenSocket_);
            listenSocket_ = INVALID_SOCKET;
            return false;
        }

        running_ = true;
        acceptThread_ = std::thread(&WebSocketServer::AcceptLoop, this);
        return true;
    }

    void Stop()
    {
        running_ = false;

        if (listenSocket_ != INVALID_SOCKET)
        {
            shutdown(listenSocket_, SD_BOTH);
            closesocket(listenSocket_);
            listenSocket_ = INVALID_SOCKET;
        }

        if (acceptThread_.joinable())
        {
            acceptThread_.join();
        }

        std::lock_guard<std::mutex> lock(clientsMutex_);
        for (SOCKET client : clients_)
        {
            shutdown(client, SD_BOTH);
            closesocket(client);
        }
        clients_.clear();
    }

    void Broadcast(const std::string& message)
    {
        const std::string frame = BuildTextFrame(message);
        std::vector<SOCKET> clients;
        {
            std::lock_guard<std::mutex> lock(clientsMutex_);
            clients = clients_;
        }

        for (SOCKET client : clients)
        {
            bool sent = false;
            {
                std::lock_guard<std::mutex> sendLock(sendMutex_);
                sent = SendAll(client, frame);
            }

            if (!sent)
            {
                RemoveClient(client);
            }
        }
    }

private:
    void AcceptLoop()
    {
        while (running_)
        {
            sockaddr_in clientAddress{};
            int clientSize = sizeof(clientAddress);
            SOCKET clientSocket = accept(listenSocket_, reinterpret_cast<sockaddr*>(&clientAddress), &clientSize);
            if (clientSocket == INVALID_SOCKET)
            {
                if (running_)
                {
                    std::this_thread::sleep_for(std::chrono::milliseconds(50));
                }
                continue;
            }

            if (HandleClient(clientSocket))
            {
                {
                    std::lock_guard<std::mutex> lock(clientsMutex_);
                    clients_.push_back(clientSocket);
                }

                std::thread(&WebSocketServer::ReceiveLoop, this, clientSocket).detach();
            }
            else
            {
                shutdown(clientSocket, SD_BOTH);
                closesocket(clientSocket);
            }
        }
    }

    bool HandleClient(SOCKET clientSocket)
    {
        std::string request;
        request.reserve(2048);

        std::array<char, 1024> buffer{};
        while (request.find("\r\n\r\n") == std::string::npos)
        {
            const int received = recv(clientSocket, buffer.data(), static_cast<int>(buffer.size()), 0);
            if (received <= 0)
            {
                return false;
            }

            request.append(buffer.data(), received);
            if (request.size() > 8192)
            {
                return false;
            }
        }

        const std::string clientKey = FindHttpHeader(request, "Sec-WebSocket-Key");
        if (clientKey.empty())
        {
            return false;
        }

        const std::string acceptKey = ComputeAcceptKey(clientKey);
        if (acceptKey.empty())
        {
            return false;
        }

        std::ostringstream response;
        response << "HTTP/1.1 101 Switching Protocols\r\n"
                 << "Upgrade: websocket\r\n"
                 << "Connection: Upgrade\r\n"
                 << "Sec-WebSocket-Accept: " << acceptKey << "\r\n\r\n";

        const std::string responseText = response.str();
        return SendAll(clientSocket, responseText);
    }

    struct ClientFrame
    {
        std::uint8_t opcode = 0;
        std::string payload;
    };

    void ReceiveLoop(SOCKET clientSocket)
    {
        while (running_)
        {
            ClientFrame frame;
            if (!ReadClientFrame(clientSocket, frame))
            {
                break;
            }

            if (frame.opcode == 0x8)
            {
                SendControlFrame(clientSocket, 0x8, frame.payload);
                break;
            }

            if (frame.opcode == 0x9)
            {
                if (!SendControlFrame(clientSocket, 0xA, frame.payload))
                {
                    break;
                }
                continue;
            }

            if (frame.opcode == 0xA)
            {
                continue;
            }
        }

        RemoveClient(clientSocket);
    }

    static bool ReceiveExact(SOCKET clientSocket, char* destination, std::size_t size)
    {
        std::size_t receivedTotal = 0;
        while (receivedTotal < size)
        {
            const int received = recv(
                clientSocket,
                destination + receivedTotal,
                static_cast<int>(size - receivedTotal),
                0);
            if (received <= 0)
            {
                return false;
            }

            receivedTotal += static_cast<std::size_t>(received);
        }

        return true;
    }

    static bool ReadClientFrame(SOCKET clientSocket, ClientFrame& frame)
    {
        std::array<unsigned char, 2> header{};
        if (!ReceiveExact(clientSocket, reinterpret_cast<char*>(header.data()), header.size()))
        {
            return false;
        }

        frame.opcode = static_cast<std::uint8_t>(header[0] & 0x0F);
        std::uint64_t payloadLength = header[1] & 0x7F;

        if (payloadLength == 126)
        {
            std::array<unsigned char, 2> extended{};
            if (!ReceiveExact(clientSocket, reinterpret_cast<char*>(extended.data()), extended.size()))
            {
                return false;
            }
            payloadLength = (static_cast<std::uint64_t>(extended[0]) << 8) |
                            static_cast<std::uint64_t>(extended[1]);
        }
        else if (payloadLength == 127)
        {
            std::array<unsigned char, 8> extended{};
            if (!ReceiveExact(clientSocket, reinterpret_cast<char*>(extended.data()), extended.size()))
            {
                return false;
            }

            payloadLength = 0;
            for (unsigned char byte : extended)
            {
                payloadLength = (payloadLength << 8) | static_cast<std::uint64_t>(byte);
            }
        }

        if (payloadLength > 65536)
        {
            return false;
        }

        std::array<unsigned char, 4> mask{};
        const bool isMasked = (header[1] & 0x80) != 0;
        if (isMasked && !ReceiveExact(clientSocket, reinterpret_cast<char*>(mask.data()), mask.size()))
        {
            return false;
        }

        frame.payload.assign(static_cast<std::size_t>(payloadLength), '\0');
        if (payloadLength > 0 &&
            !ReceiveExact(clientSocket, frame.payload.data(), static_cast<std::size_t>(payloadLength)))
        {
            return false;
        }

        if (isMasked)
        {
            for (std::size_t index = 0; index < frame.payload.size(); ++index)
            {
                frame.payload[index] = static_cast<char>(
                    static_cast<unsigned char>(frame.payload[index]) ^ mask[index % mask.size()]);
            }
        }

        return true;
    }

    bool SendControlFrame(SOCKET clientSocket, std::uint8_t opcode, std::string_view payload)
    {
        if (payload.size() > 125)
        {
            return false;
        }

        const std::string frame = BuildFrame(opcode, payload);
        std::lock_guard<std::mutex> sendLock(sendMutex_);
        return SendAll(clientSocket, frame);
    }

    void RemoveClient(SOCKET clientSocket)
    {
        bool shouldClose = false;
        {
            std::lock_guard<std::mutex> lock(clientsMutex_);
            const auto it = std::find(clients_.begin(), clients_.end(), clientSocket);
            if (it != clients_.end())
            {
                clients_.erase(it);
                shouldClose = true;
            }
        }

        if (shouldClose)
        {
            shutdown(clientSocket, SD_BOTH);
            closesocket(clientSocket);
        }
    }

    static std::string ComputeAcceptKey(const std::string& clientKey)
    {
        const std::string input = clientKey + std::string(kWebSocketGuid);

        HCRYPTPROV cryptoProvider = 0;
        HCRYPTHASH hash = 0;
        std::array<BYTE, 20> hashBytes{};
        DWORD hashLength = static_cast<DWORD>(hashBytes.size());

        if (!CryptAcquireContextW(&cryptoProvider, nullptr, nullptr, PROV_RSA_AES, CRYPT_VERIFYCONTEXT))
        {
            return {};
        }

        if (!CryptCreateHash(cryptoProvider, CALG_SHA1, 0, 0, &hash))
        {
            CryptReleaseContext(cryptoProvider, 0);
            return {};
        }

        CryptHashData(hash, reinterpret_cast<const BYTE*>(input.data()), static_cast<DWORD>(input.size()), 0);
        CryptGetHashParam(hash, HP_HASHVAL, hashBytes.data(), &hashLength, 0);

        DWORD base64Size = 0;
        CryptBinaryToStringA(hashBytes.data(), hashLength, CRYPT_STRING_BASE64 | CRYPT_STRING_NOCRLF, nullptr, &base64Size);
        std::string result(base64Size, '\0');
        CryptBinaryToStringA(hashBytes.data(), hashLength, CRYPT_STRING_BASE64 | CRYPT_STRING_NOCRLF, result.data(), &base64Size);
        if (!result.empty() && result.back() == '\0')
        {
            result.pop_back();
        }

        CryptDestroyHash(hash);
        CryptReleaseContext(cryptoProvider, 0);
        return result;
    }

    static bool SendAll(SOCKET clientSocket, std::string_view message)
    {
        std::size_t sentTotal = 0;
        while (sentTotal < message.size())
        {
            const int sent = send(
                clientSocket,
                message.data() + sentTotal,
                static_cast<int>(message.size() - sentTotal),
                0);
            if (sent == SOCKET_ERROR || sent == 0)
            {
                return false;
            }

            sentTotal += static_cast<std::size_t>(sent);
        }

        return true;
    }

    static std::string BuildFrame(std::uint8_t opcode, std::string_view message)
    {
        std::string frame;
        frame.reserve(message.size() + 10);
        frame.push_back(static_cast<char>(0x80 | opcode));

        const std::size_t size = message.size();
        if (size <= 125)
        {
            frame.push_back(static_cast<char>(size));
        }
        else if (size <= 65535)
        {
            frame.push_back(static_cast<char>(126));
            frame.push_back(static_cast<char>((size >> 8) & 0xFF));
            frame.push_back(static_cast<char>(size & 0xFF));
        }
        else
        {
            frame.push_back(static_cast<char>(127));
            for (int shift = 56; shift >= 0; shift -= 8)
            {
                frame.push_back(static_cast<char>((size >> shift) & 0xFF));
            }
        }

        frame.append(message);
        return frame;
    }

    static std::string BuildTextFrame(const std::string& message)
    {
        return BuildFrame(0x1, message);
    }

    std::atomic<bool> running_{false};
    SOCKET listenSocket_ = INVALID_SOCKET;
    std::thread acceptThread_;
    std::mutex clientsMutex_;
    std::mutex sendMutex_;
    std::vector<SOCKET> clients_;
};

int main()
{
    TelemetryService telemetryService;
    WebSocketServer server;

    if (!server.Start(kWebSocketPort))
    {
        std::cerr << "WebSocket server failed to start." << std::endl;
        return 1;
    }

    std::cout << "ACC bridge started on ws://localhost:" << kWebSocketPort << std::endl;

    int tickCount = 0;
    while (true)
    {
        const TelemetryFrame frame = telemetryService.Sample();
        const std::string payload = frame.ToJson();
        server.Broadcast(payload);

        // フルJSONのコンソール出力は20Hzだと標準出力I/Oがブロックして遅延の原因になるため、
        // 配信(Broadcast)自体は毎回50ms間隔のまま行い、コンソール表示だけ1秒に1回(20ティックに1回)に間引く。
        if (++tickCount >= 20)
        {
            tickCount = 0;
            std::cout << payload << std::endl;
        }

        std::this_thread::sleep_for(std::chrono::milliseconds(50));
    }
}
