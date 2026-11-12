// BasedCode.exe: starts the bundled Node.js on the desktop launcher script without a console window.
// Compiled by scripts/package-win.mjs with the .NET Framework csc.exe that ships with Windows.
using System;
using System.Diagnostics;
using System.IO;
using System.Windows.Forms;

static class Launcher
{
    [STAThread]
    static int Main(string[] args)
    {
        string root = AppDomain.CurrentDomain.BaseDirectory;
        string node = Path.Combine(root, "node.exe");
        string script = Path.Combine(root, "app", "scripts", "desktop.mjs");
        string runtime = Path.Combine(root, "nwjs", "nw.exe");
        try
        {
            var start = new ProcessStartInfo(node, "\"" + script + "\"")
            {
                UseShellExecute = false,
                CreateNoWindow = true,
                WorkingDirectory = Path.Combine(root, "app"),
            };
            start.EnvironmentVariables["BASEDCODE_NW_RUNTIME"] = runtime;
            start.EnvironmentVariables["BASEDCODE_PACKAGED"] = "1";
            start.EnvironmentVariables["BASEDCODE_INSTALL_DIR"] = root;
            // No BASEDCODE_DATA_DIR: the install folder (Program Files) is read-only, so user data
            // goes to the app's default, %LOCALAPPDATA%\BasedCode.
            start.EnvironmentVariables.Remove("BASEDCODE_DATA_DIR");
            Process.Start(start);
            return 0;
        }
        catch (Exception error)
        {
            MessageBox.Show("BasedCode could not start:\n" + error.Message, "BasedCode",
                MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }
    }
}
