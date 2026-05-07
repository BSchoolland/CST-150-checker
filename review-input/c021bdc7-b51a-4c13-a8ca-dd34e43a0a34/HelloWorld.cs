namespace activity_1
{
    public partial class HelloWorld : Form
    {
        // Initialize the Component
        public HelloWorld()
        {
            InitializeComponent();
        }
        // When the button is clicked, set the label to show my name
        private void btnDisplayName_Click(object sender, EventArgs e)
        {
            // Create name variable
            string authorName = "Ben Schoolland";
            // set the .Text property of lblName.  This updates the display
            lblName.Text = authorName;
        }
    }
}
