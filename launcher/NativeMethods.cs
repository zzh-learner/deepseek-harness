namespace DshLauncher;

using System.Runtime.InteropServices;

/// <summary>
/// Win32 interop used by <see cref="ProcessService"/>: mapping a listening TCP
/// port to its owning PID (GetExtendedTcpTable) and walking a process's parent
/// PID (NtQueryInformationProcess). All wrappers return empty/null instead of
/// throwing when the OS call fails; callers treat that as "chain ends here".
/// </summary>
internal static class NativeMethods
{
    private const int AfInet = 2;
    private const int TcpTableOwnerPidAll = 5;

    [DllImport("iphlpapi.dll")]
    private static extern int GetExtendedTcpTable(IntPtr tcpTable, ref int size, bool order, int family, int tableClass, int reserved);

    /// <summary>MIB_TCPROW_OWNER_PID: six 32-bit fields, no pointer-size members.</summary>
    [StructLayout(LayoutKind.Sequential)]
    private struct MibTcpRowOwnerPid
    {
        public uint State;
        public uint LocalAddr;
        public uint LocalPort;
        public uint RemoteAddr;
        public uint RemotePort;
        public uint OwningPid;
    }

    /// <summary>One TCP row as read from GetExtendedTcpTable, with the port still in network byte order.</summary>
    public readonly record struct TcpRow(uint State, uint LocalPort, uint LocalAddr, uint OwningPid);

    private static IntPtr _tableBuffer = IntPtr.Zero;
    private static TcpRow[] _cachedRows = [];

    /// <summary>MIB_TCP_STATE_LISTEN.</summary>
    public const uint TcpListen = 2;

    /// <summary>Return the PID of the process listening on <paramref name="port"/> on any IPv4 address, or null.</summary>
    public static int? FindListenerPid(int port)
    {
        foreach (var row in ReadTcpTable())
        {
            if (row.State == TcpListen && SwapPortBytes(row.LocalPort) == port && row.OwningPid != 0)
            {
                return (int)row.OwningPid;
            }
        }

        return null;
    }

    /// <summary>
    /// Read the IPv4 owner table. The sizing call deliberately returns
    /// ERROR_INSUFFICIENT_BUFFER (122) with the required size; only the second
    /// call must succeed. Rows are cached per process because status polls
    /// consult them repeatedly; each refresh frees the previous buffer.
    /// </summary>
    public static TcpRow[] ReadTcpTable()
    {
        var size = 0;
        GetExtendedTcpTable(IntPtr.Zero, ref size, false, AfInet, TcpTableOwnerPidAll, 0);
        if (size == 0)
        {
            return _cachedRows;
        }

        if (_tableBuffer != IntPtr.Zero)
        {
            Marshal.FreeHGlobal(_tableBuffer);
            _tableBuffer = IntPtr.Zero;
        }

        var buffer = Marshal.AllocHGlobal(size);
        var rc = GetExtendedTcpTable(buffer, ref size, false, AfInet, TcpTableOwnerPidAll, 0);
        if (rc != 0)
        {
            Marshal.FreeHGlobal(buffer);
            return _cachedRows;
        }

        _tableBuffer = buffer;
        var count = Marshal.ReadInt32(buffer);
        var rows = new TcpRow[count];
        var rowOffset = buffer + sizeof(int);
        var rowSize = Marshal.SizeOf<MibTcpRowOwnerPid>();
        for (var i = 0; i < count; i++)
        {
            var row = Marshal.PtrToStructure<MibTcpRowOwnerPid>(rowOffset + i * rowSize);
            rows[i] = new TcpRow(row.State, row.LocalPort, row.LocalAddr, row.OwningPid);
        }

        _cachedRows = rows;
        return rows;
    }

    /// <summary>MIB ports are network byte order; convert to host order.</summary>
    public static int SwapPortBytes(uint networkPort)
        => (int)((networkPort & 0xff) << 8 | (networkPort >> 8) & 0xff);

    [DllImport("ntdll.dll")]
    private static extern int NtQueryInformationProcess(IntPtr processHandle, int infoClass, ref ProcessBasicInformation info, int size, out int returnLength);

    /// <summary>PROCESS_BASIC_INFORMATION with pointer-sized members; correct on x64 and x86.</summary>
    [StructLayout(LayoutKind.Sequential)]
    private struct ProcessBasicInformation
    {
        public IntPtr Reserved1;
        public IntPtr PebBaseAddress;
        public IntPtr Reserved2a;
        public IntPtr Reserved2b;
        public IntPtr UniqueProcessId;
        public IntPtr InheritedFromUniqueProcessId;
    }

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr OpenProcess(int access, bool inherit, int pid);

    [DllImport("kernel32.dll")]
    private static extern bool CloseHandle(IntPtr handle);

    [DllImport("user32.dll")]
    private static extern bool DestroyIcon(IntPtr handle);

    private const int ProcessQueryLimitedInformation = 0x1000;

    /// <summary>Return the parent PID of <paramref name="pid"/>, or null when the query fails.</summary>
    public static int? FindParentPid(int pid)
    {
        var handle = OpenProcess(ProcessQueryLimitedInformation, false, pid);
        if (handle == IntPtr.Zero)
        {
            return null;
        }

        try
        {
            var info = new ProcessBasicInformation();
            var rc = NtQueryInformationProcess(handle, 0, ref info, Marshal.SizeOf<ProcessBasicInformation>(), out _);
            if (rc != 0)
            {
                return null;
            }

            var parent = (int)info.InheritedFromUniqueProcessId;
            return parent <= 0 ? null : parent;
        }
        finally
        {
            CloseHandle(handle);
        }
    }

    /// <summary>Release an icon handle obtained from Bitmap.GetHicon().</summary>
    public static void SafeDestroyIcon(IntPtr handle)
    {
        if (handle != IntPtr.Zero)
        {
            DestroyIcon(handle);
        }
    }
}
