namespace TestApp;

static class Program
{
    [STAThread]
    static void Main()
    {
        // Use the MODERN initialization (same as student templates)
        // This is what crashes on Wine
        ApplicationConfiguration.Initialize();
        Application.Run(new MainForm());
    }
}
