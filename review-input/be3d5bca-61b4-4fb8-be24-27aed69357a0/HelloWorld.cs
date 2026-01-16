namespace activity_1
{
    public partial class HelloWorld : Form
    {
        // Initialize the Component
        public HelloWorld()
        {
            InitializeComponent();
        }

        private void ShowNameButton_Click(object sender, EventArgs e)
        {
            // Create name variable
            string authorName = "Ben Schoolland";
            // set the .Text property of lblName.  This updates the display
            lblName.Text = authorName;
        }
    }
}
