namespace TestApp;

public partial class MainForm : Form
{
    public MainForm()
    {
        InitializeComponent();
    }
    
    private void btnDisplayName_Click(object sender, EventArgs e)
    {
        string authorName = "Test User";
        lblName.Text = authorName;
    }
}

// Designer portion (normally in separate file)
partial class MainForm
{
    private System.ComponentModel.IContainer? components = null;
    
    protected override void Dispose(bool disposing)
    {
        if (disposing && (components != null))
        {
            components.Dispose();
        }
        base.Dispose(disposing);
    }
    
    private void InitializeComponent()
    {
        ShowNameButton = new Button();
        lblName = new Label();
        SuspendLayout();
        
        // ShowNameButton - EXACT match of student's code
        ShowNameButton.Location = new Point(317, 149);
        ShowNameButton.Name = "ShowNameButton";
        ShowNameButton.Size = new Size(172, 69);
        ShowNameButton.TabIndex = 0;
        ShowNameButton.Text = "Click Me!";
        ShowNameButton.UseVisualStyleBackColor = true;
        ShowNameButton.Click += btnDisplayName_Click;
        
        // lblName
        lblName.AutoSize = true;
        lblName.Location = new Point(317, 242);
        lblName.Name = "lblName";
        lblName.Size = new Size(162, 20);
        lblName.TabIndex = 1;
        lblName.Text = "click the button please!";
        
        // MainForm
        AutoScaleDimensions = new SizeF(8F, 20F);
        AutoScaleMode = AutoScaleMode.Font;
        ClientSize = new Size(800, 450);
        Controls.Add(lblName);
        Controls.Add(ShowNameButton);
        Name = "MainForm";
        Text = "Form1";
        ResumeLayout(false);
        PerformLayout();
    }
    
    private Button ShowNameButton;
    private Label lblName;
}
