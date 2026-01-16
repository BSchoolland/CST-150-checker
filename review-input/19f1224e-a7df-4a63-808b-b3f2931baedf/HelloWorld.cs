namespace activity_1
{
    public partial class HelloWorld : Form
    {
        public HelloWorld()
        {
            InitializeComponent();
        }

        private void button1_Click(object sender, EventArgs e)
        {
            string myText = "Ben Schoolland";
            myLabel.Text = myText;
        }
    }
}
